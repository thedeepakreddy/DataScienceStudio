"""Tableau and Power BI workbooks: the data they carry, their sheets as a studio
dashboard, and their simple calculations as KPI formulas, with a conversion
report that says what was converted, approximated or left out (and why).

- Tableau .twbx (a ZIP with the .twb and its data: .hyper extracts, CSV, Excel),
  .twb (the workbook only; its data lives elsewhere) and .hyper extracts.
- Power BI .pbix (a ZIP with the report layout and the data model; tables and
  DAX measures are read with pbixray).

Only each vendor's app draws and calculates its files exactly; this keeps the
data exact and rebuilds the rest where the studio has an equivalent."""
from __future__ import annotations

import json
import os
import re
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

import pandas as pd
from pydantic import BaseModel, Field

from ..core import EngineError
from ..registry import capability

MAX_MEMBERS = 2000
MAX_UNPACKED = int(float(os.environ.get("ENGINE_MAX_UPLOAD_MB", "2048")) * 1024 * 1024) * 3
DATA_EXT = {".csv", ".tsv", ".txt", ".xlsx", ".xls", ".json", ".parquet"}


class BiParams(BaseModel):
    file_id: str | None = Field(None, max_length=200, description="A file uploaded with POST /v2/files/upload (.twbx, .twb, .hyper or .pbix).")
    uri: str | None = Field(None, max_length=1000, description="Or a gs:// address of the file (for files too large to upload directly).")
    name: str | None = Field(None, max_length=200, description="A name prefix for the imported tables.")
    max_rows: int = Field(2_000_000, ge=1, le=50_000_000, description="Most rows to read from any one table.")


# ---------------------------------------------------------------- helpers
def _safe_xml(raw: bytes) -> ET.Element:
    head = raw[:4096].decode("utf-8", "ignore") if raw[:2] not in (b"\xff\xfe", b"\xfe\xff") else raw[:8192].decode("utf-16", "ignore")
    if "<!DOCTYPE" in head or "<!ENTITY" in head:
        raise EngineError("This workbook contains XML entities, which aren't accepted.")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as err:
        raise EngineError(f"The workbook's XML couldn't be read: {err}") from err


def _members(z: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    infos = [i for i in z.infolist() if not i.is_dir()]
    if len(infos) > MAX_MEMBERS:
        raise EngineError("The package holds too many files.")
    if sum(i.file_size for i in infos) > MAX_UNPACKED:
        raise EngineError("The package is too large once unpacked.", 413, "too_large")
    return infos


def _to_temp(z: zipfile.ZipFile, info: zipfile.ZipInfo) -> str:
    """A member written to a fresh temp file (never to the path stored in the ZIP)."""
    suffix = os.path.splitext(info.filename)[1].lower()[:10]
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    with z.open(info) as src:
        while chunk := src.read(1 << 20):
            tmp.write(chunk)
    tmp.close()
    return tmp.name


def _hyper_tables(path: str, max_rows: int) -> list[tuple[str, pd.DataFrame]]:
    try:
        from tableauhyperapi import Connection, HyperProcess, Telemetry
    except ImportError as err:  # pragma: no cover
        raise EngineError("Reading Tableau extracts needs the Hyper API, which isn't installed here.") from err
    out = []
    with HyperProcess(telemetry=Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU, parameters={"log_config": ""}) as hp:
        with Connection(hp.endpoint, path) as c:
            for schema in c.catalog.get_schema_names():
                for table in c.catalog.get_table_names(schema):
                    cols = [str(col.name.unescaped) for col in c.catalog.get_table_definition(table).columns]
                    rows = c.execute_list_query(f"SELECT * FROM {table} LIMIT {int(max_rows)}")
                    df = pd.DataFrame(rows, columns=cols)
                    # Hyper dates and timestamps come back as its own types; plain strings convert cleanly.
                    for col in df.columns:
                        if df[col].dtype == object and len(df) and type(df[col].dropna().iloc[0] if df[col].notna().any() else None).__module__.startswith("tableauhyperapi"):
                            df[col] = pd.to_datetime(df[col].astype(str), errors="coerce")
                    out.append((str(table.name.unescaped), df))
    return out


def _clean_name(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("_", " ")).strip()


# ---------------------------------------------------------------- Tableau
_FIELD = re.compile(r"\[([^\]]+)\]\.\[(?:(\w+):)?([^:\]]+)(?::(\w+))?\]")
_AGG = {"sum": "SUM", "avg": "AVG", "min": "MIN", "max": "MAX", "cnt": "COUNT", "ctd": "COUNT_DISTINCT", "med": "MEDIAN", "usr": None, "none": None}
_DATE_DERIV = re.compile(r"^(yr|qr|mn|tmn|tdy|twk|tyr|tqr|wk|dy|md|my|mdy)$")


def _fields(text: str | None) -> list[dict[str, Any]]:
    """Field references on a shelf: [ds].[deriv:Name:kind] → name, aggregation, measure or dimension."""
    out = []
    for ds, deriv, name, kind in _FIELD.findall(text or ""):
        deriv = (deriv or "none").lower()
        out.append({"datasource": ds, "name": name, "agg": _AGG.get(deriv), "date_part": bool(_DATE_DERIV.match(deriv)),
                    "measure": (kind or "").startswith("q") or deriv in ("sum", "avg", "min", "max", "cnt", "ctd", "med")})
    return out


_TABLEAU_FUNCS = {"SUM": "SUM", "AVG": "AVG", "MIN": "MIN", "MAX": "MAX", "COUNT": "COUNT", "COUNTD": "COUNT_DISTINCT", "MEDIAN": "MEDIAN"}


def translate_tableau(formula: str, captions: dict[str, str]) -> tuple[str | None, str]:
    """A Tableau aggregate calculation as a studio KPI formula, or why it can't be one."""
    f = formula.strip()
    if "{" in f:
        return None, "level-of-detail expression (FIXED / INCLUDE / EXCLUDE)"
    if re.search(r"\b(WINDOW_|RUNNING_|RANK|INDEX|LOOKUP|PREVIOUS_VALUE|TOTAL)\w*\s*\(", f, re.I):
        return None, "table calculation"
    if re.search(r"\b(IF|CASE|IIF|ZN|DATEPART|DATETRUNC|DATEDIFF|CONTAINS|LEFT|RIGHT|MID|ATTR)\b", f, re.I):
        return None, "row-level logic (IF, CASE, dates or text functions)"
    if not re.search(r"\b(SUM|AVG|MIN|MAX|COUNT|COUNTD|MEDIAN)\s*\(", f, re.I):
        return None, "row-level calculation (no aggregation)"
    out = re.sub(r"\b(SUM|AVG|MIN|MAX|COUNTD|COUNT|MEDIAN)\s*\(", lambda m: _TABLEAU_FUNCS[m.group(1).upper()] + "(", f, flags=re.I)
    out = re.sub(r"\[([^\]]+)\]", lambda m: f"[{captions.get(m.group(1), m.group(1))}]", out)
    if re.search(r"[^\w\s\[\]().+\-*/,]", out):
        return None, "uses operators the studio's formulas don't have"
    return out, ""


def _sheet_chart(mark: str, cols: list[dict], rows: list[dict], color: list[dict]) -> tuple[str | None, list[str], str, str]:
    """A worksheet as one of the studio's charts: (type, columns, status, note)."""
    fields = cols + rows
    names = [f["name"] for f in fields]
    if any(n in ("Latitude (generated)", "Longitude (generated)") for n in names):
        dims = [f["name"] for f in fields + color if not f["measure"] and "(generated)" not in f["name"]]
        return ("Bar Chart", dims[:1] + [f["name"] for f in fields + color if f["measure"]][:1], "approximated", "a map, shown as a bar chart of its locations") if dims else (None, [], "skipped", "a map with no field to chart")
    measures = [f for f in fields + color if f["measure"]]
    dims = [f for f in fields + color if not f["measure"]]
    m = (mark or "Automatic").lower()
    dates = [d for d in dims if d["date_part"]]
    if m == "pie" or (m == "automatic" and color and not cols and not rows):
        return ("Pie Chart", [(color or dims or [{"name": ""}])[0]["name"]] + [x["name"] for x in measures[:1]], "converted", "")
    if m in ("line", "area") or (m == "automatic" and dates and measures):
        x = (dates or dims)
        if not x or not measures:
            return None, [], "skipped", "a line chart without a date or a measure"
        return ("Area Chart" if m == "area" else "Line Chart", [x[0]["name"], measures[0]["name"]], "converted", "")
    if m in ("circle", "shape") and len(measures) >= 2:
        return ("Scatter Plot", [measures[0]["name"], measures[1]["name"]] + [d["name"] for d in dims[:1]], "converted", "")
    if m in ("bar", "automatic", "square", "gantt bar") and dims and measures:
        return ("Bar Chart", [dims[0]["name"], measures[0]["name"]], "converted" if m in ("bar", "automatic") else "approximated", "" if m in ("bar", "automatic") else f"a {m} chart, shown as bars")
    if m == "text" or (dims and not measures):
        return ("Data Table", [f["name"] for f in fields + color][:8], "approximated", "a text table, shown as a data table")
    if len(measures) >= 2:
        return ("Scatter Plot", [measures[0]["name"], measures[1]["name"]], "approximated", f"a {m} chart, shown as a scatter plot")
    if measures:
        return ("Histogram", [measures[0]["name"]], "approximated", "a single measure, shown as its distribution")
    return None, [], "skipped", "no fields on the sheet"


def parse_twb(root: ET.Element) -> dict[str, Any]:
    captions: dict[str, str] = {}
    calcs = []
    for col in root.iter("column"):
        name = (col.get("name") or "").strip("[]")
        cap = col.get("caption")
        if cap:
            captions[name] = cap
        calc = col.find("calculation")
        if calc is not None and calc.get("formula"):
            calcs.append({"name": cap or name, "id": name, "formula": calc.get("formula"), "role": col.get("role")})
    for c in calcs:
        kpi, why = translate_tableau(c["formula"], captions)
        c.update({"kpi": kpi, "status": "converted" if kpi else "skipped", "note": why})
        c.pop("id", None)
    sheets = []
    for ws in root.iter("worksheet"):
        table = ws.find("table")
        mark_el = ws.find(".//pane/mark")
        def shelf(tag: str) -> list[dict]:
            el = table.find(tag) if table is not None else None
            return [{**f, "name": captions.get(f["name"], f["name"])} for f in _fields(el.text if el is not None else None)]
        color = [{**f, "name": captions.get(f["name"], f["name"])} for enc in ws.iter("color") for f in _fields(enc.get("column"))]
        ctype, columns, status, note = _sheet_chart(mark_el.get("class") if mark_el is not None else "Automatic", shelf("cols"), shelf("rows"), color)
        sheets.append({"name": ws.get("name"), "chart": ctype, "columns": columns, "status": status, "note": note})
    dashboards = [{"name": d.get("name"), "sheets": [z.get("name") for z in d.iter("zone") if z.get("name")]} for d in root.iter("dashboard")]
    sources = [{"name": ds.get("caption") or ds.get("name"),
                "connections": sorted({c.get("class") for c in ds.iter("connection") if c.get("class") and c.get("class") != "federated"})}
               for ds in root.iter("datasource") if ds.get("name") != "Parameters"]
    return {"sheets": sheets, "calculations": calcs, "dashboards": dashboards, "sources": sources}


# ---------------------------------------------------------------- Power BI
_PBI_CHART = {
    "clusteredBarChart": "Bar Chart", "clusteredColumnChart": "Bar Chart", "barChart": "Bar Chart", "columnChart": "Bar Chart",
    "stackedBarChart": "Bar Chart", "stackedColumnChart": "Bar Chart", "hundredPercentStackedBarChart": "Bar Chart",
    "hundredPercentStackedColumnChart": "Bar Chart", "lineChart": "Line Chart", "areaChart": "Area Chart", "stackedAreaChart": "Area Chart",
    "lineClusteredColumnComboChart": "Line Chart", "lineStackedColumnComboChart": "Line Chart", "pieChart": "Pie Chart", "donutChart": "Pie Chart",
    "scatterChart": "Scatter Plot", "tableEx": "Data Table", "pivotTable": "Data Table", "matrix": "Data Table", "card": "KPI Cards",
    "multiRowCard": "KPI Cards", "kpi": "KPI Cards", "treemap": "Bar Chart", "funnel": "Bar Chart", "waterfallChart": "Bar Chart",
    "map": "Bar Chart", "filledMap": "Bar Chart", "azureMap": "Bar Chart",
}
_PBI_APPROX = {"treemap", "funnel", "waterfallChart", "map", "filledMap", "azureMap", "lineClusteredColumnComboChart", "lineStackedColumnComboChart",
               "hundredPercentStackedBarChart", "hundredPercentStackedColumnChart", "pivotTable", "matrix"}
_PBI_SKIP = {"slicer": "a slicer (use the dashboard's filters)", "textbox": "a text box", "image": "an image", "shape": "a shape",
             "actionButton": "a button", "basicShape": "a shape", "pageNavigator": "page navigation"}


def _queryref_col(ref: str) -> tuple[str, str | None]:
    """'Sum(Sales.Amount)' → ('Amount', 'SUM'); 'Sales.Region' → ('Region', None)."""
    m = re.match(r"^(\w+)\((.+)\)$", ref)
    agg = None
    if m:
        agg = {"sum": "SUM", "avg": "AVG", "average": "AVG", "min": "MIN", "max": "MAX", "count": "COUNT", "countnonnull": "COUNT"}.get(m.group(1).lower())
        ref = m.group(2)
    return ref.split(".", 1)[1] if "." in ref else ref, agg


def parse_pbix_layout(layout: dict[str, Any]) -> list[dict[str, Any]]:
    visuals = []
    for page in layout.get("sections", []):
        for vc in page.get("visualContainers", []):
            try:
                cfg = json.loads(vc.get("config") or "{}")
            except ValueError:
                continue
            sv = cfg.get("singleVisual") or {}
            vt = sv.get("visualType")
            if not vt:
                continue
            title = None
            try:
                title = sv["vcObjects"]["title"][0]["properties"]["text"]["expr"]["Literal"]["Value"].strip("'")
            except (KeyError, IndexError, TypeError):
                pass
            roles = sv.get("projections") or {}
            cols = []
            for role in ("Category", "Axis", "Legend", "Series", "Rows", "Columns", "X", "Y", "Values", "Size", "Fields"):
                for p in roles.get(role, []):
                    name, _ = _queryref_col(p.get("queryRef", ""))
                    if name and name not in cols:
                        cols.append(name)
            name = f"{page.get('displayName', 'Page')} · {title or vt}"
            if vt in _PBI_SKIP:
                visuals.append({"name": name, "chart": None, "columns": cols, "status": "skipped", "note": _PBI_SKIP[vt]})
            elif vt in _PBI_CHART and cols:
                chart = _PBI_CHART[vt]
                visuals.append({"name": name, "chart": chart, "columns": cols[:8 if chart == "Data Table" else 3],
                                "status": "approximated" if vt in _PBI_APPROX else "converted",
                                "note": f"a {vt}, shown as a {chart.lower()}" if vt in _PBI_APPROX else ""})
            else:
                visuals.append({"name": name, "chart": None, "columns": cols, "status": "skipped", "note": f"a {vt} visual the studio has no equivalent for" if cols else "no fields"})
    return visuals


def translate_dax(expr: str) -> tuple[str | None, str]:
    """A simple DAX measure as a studio KPI formula, or why it can't be one."""
    e = re.sub(r"\s+", " ", expr.strip())
    if re.search(r"\b(CALCULATE|FILTER|ALL|ALLEXCEPT|SAMEPERIODLASTYEAR|DATEADD|TOTALYTD|DATESYTD|PARALLELPERIOD|RELATED|USERELATIONSHIP|SUMX|AVERAGEX|COUNTX|MAXX|MINX|RANKX|SWITCH|IF|VAR|EARLIER|LOOKUPVALUE|SELECTEDVALUE|HASONEVALUE|VALUES)\b", e, re.I):
        return None, "uses filter context, iterators or time intelligence (needs Power BI's engine)"
    def col(m: re.Match) -> str:
        return f"[{m.group(2)}]"
    out = e
    out = re.sub(r"\bDIVIDE\s*\(([^,()]+(?:\([^()]*\))?[^,()]*),\s*([^,()]+(?:\([^()]*\))?[^,()]*)(?:,[^()]*)?\)", r"(\1) / (\2)", out, flags=re.I)
    out = re.sub(r"\bCOUNTROWS\s*\(\s*'?[\w ]+'?\s*\)", "COUNT()", out, flags=re.I)
    out = re.sub(r"\bDISTINCTCOUNT\s*\(", "COUNT_DISTINCT(", out, flags=re.I)
    out = re.sub(r"\bAVERAGE\s*\(", "AVG(", out, flags=re.I)
    out = re.sub(r"\bCOUNTA?\s*\(", "COUNT(", out, flags=re.I)
    out = re.sub(r"('?)[\w ]*\1\[([^\]]+)\]", col, out)  # 'Table'[Column] or Table[Column] → [Column]
    if not re.search(r"\b(SUM|AVG|MIN|MAX|COUNT|COUNT_DISTINCT|MEDIAN)\s*\(", out):
        return None, "no aggregation the studio can compute"
    if re.search(r"[^\w\s\[\]().+\-*/,]", out) or re.search(r"\b(?!SUM|AVG|MIN|MAX|COUNT|COUNT_DISTINCT|MEDIAN)[A-Z]{3,}\s*\(", out):
        return None, "uses functions the studio's formulas don't have"
    return out, ""


def _pbix(path: str, max_rows: int) -> tuple[list[tuple[str, pd.DataFrame]], list[dict], list[dict], list[str]]:
    notes: list[str] = []
    with zipfile.ZipFile(path) as z:
        names = [i.filename for i in _members(z)]
        visuals = []
        if "Report/Layout" in names:
            raw = z.read("Report/Layout")
            try:
                visuals = parse_pbix_layout(json.loads(raw.decode("utf-16-le" if raw[:2] != b"{\x00"[:2] or b"\x00" in raw[:4] else "utf-8").lstrip("﻿")))
            except (ValueError, UnicodeDecodeError):
                notes.append("The report layout couldn't be read, so no visuals were rebuilt.")
        else:
            notes.append("This file has no classic report layout (a newer format); visuals weren't rebuilt.")
    tables: list[tuple[str, pd.DataFrame]] = []
    measures: list[dict] = []
    try:
        from pbixray import PBIXRay
        model = PBIXRay(path)
        for t in list(model.tables):
            if str(t).startswith(("LocalDateTable_", "DateTableTemplate_")):
                continue  # Power BI's hidden date tables
            try:
                df = model.get_table(t)
                tables.append((str(t), df.head(max_rows)))
            except Exception as err:  # noqa: BLE001 - one unreadable table mustn't stop the rest
                notes.append(f"Table “{t}” couldn't be read ({str(err).splitlines()[0][:120]}).")
        dax = getattr(model, "dax_measures", None)
        if dax is not None and len(dax):
            for _, r in dax.iterrows():
                kpi, why = translate_dax(str(r.get("Expression", "")))
                measures.append({"name": str(r.get("Name")), "formula": str(r.get("Expression", "")), "kpi": kpi,
                                 "status": "converted" if kpi else "skipped", "note": why})
    except ImportError:  # pragma: no cover
        notes.append("Reading Power BI data needs pbixray, which isn't installed here.")
    except Exception as err:  # noqa: BLE001
        notes.append(f"The data model couldn't be read ({str(err).splitlines()[0][:160]}). It may be a version pbixray doesn't support yet.")
    return tables, visuals, measures, notes


def _from_gcs(storage, uri: str) -> str:  # pragma: no cover - needs Google Cloud credentials
    """A large workbook uploaded to Cloud Storage, copied next to directly uploaded ones."""
    import uuid

    from google.cloud import storage as gcs

    if not uri.startswith("gs://"):
        raise EngineError("The address must start with gs://.")
    bucket, _, path = uri[5:].partition("/")
    name = re.sub(r"[^\w.\- ]+", "_", os.path.basename(path))[:150]
    if os.path.splitext(name)[1].lower() not in (".twbx", ".twb", ".hyper", ".pbix"):
        raise EngineError("Choose a .twbx, .twb, .hyper or .pbix file.")
    tmp = tempfile.NamedTemporaryFile(suffix=os.path.splitext(name)[1], delete=False).name
    try:
        blob = gcs.Client().bucket(bucket).blob(path)
        if not blob.exists():
            raise EngineError(f"{uri} wasn't found or isn't readable.")
        blob.download_to_filename(tmp)
        file_id = "file_" + uuid.uuid4().hex[:20]
        storage.put_file(f"files/{file_id}/{name}", tmp)
        return file_id
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


# ---------------------------------------------------------------- the capability
@capability("connect.bi", "connect", "Import a Tableau or Power BI workbook",
            "Reads the data a Tableau (.twbx, .hyper) or Power BI (.pbix) file carries into datasets, rebuilds its sheets or visuals as a studio dashboard where there is an equivalent chart, turns simple calculations and measures into KPI formulas, and reports what was converted, approximated or left out. A .twb holds no data, so only its structure is read.",
            BiParams, needs_dataset=False, heavy=True, cacheable=False, tags=["import", "tableau", "power bi"])
def import_bi(ctx, p: BiParams):  # noqa: C901 - one branch per file kind
    storage = ctx.datasets.storage
    if p.uri:
        p.file_id = _from_gcs(storage, p.uri)
    if not p.file_id:
        raise EngineError("Upload the workbook first (file_id), or give its gs:// address (uri).")
    keys = [k for k in storage.list(f"files/{p.file_id}") if not k.endswith(".json")]
    if not keys:
        raise EngineError("That uploaded file wasn't found; upload it again.", 404, "not_found")
    path = storage.local_path(keys[0])
    filename = os.path.basename(keys[0])
    ext = os.path.splitext(filename)[1].lower()
    prefix = p.name or os.path.splitext(filename)[0]
    tables: list[tuple[str, pd.DataFrame]] = []
    files: list[tuple[str, str]] = []  # (temp path, original name) for plain data files
    notes: list[str] = []
    workbook: dict[str, Any] = {"sheets": [], "calculations": [], "dashboards": [], "sources": []}
    product = "tableau"
    temps: list[str] = []
    try:
        if ext == ".twbx":
            with zipfile.ZipFile(path) as z:
                infos = _members(z)
                twb = next((i for i in infos if i.filename.lower().endswith(".twb")), None)
                if twb is None:
                    raise EngineError("This .twbx has no workbook (.twb) inside.")
                workbook = parse_twb(_safe_xml(z.read(twb)))
                for i in infos:
                    low = i.filename.lower()
                    if low.endswith(".hyper"):
                        t = _to_temp(z, i)
                        temps.append(t)
                        tables += _hyper_tables(t, p.max_rows)
                    elif low.endswith(".tde"):
                        notes.append(f"{os.path.basename(i.filename)} is an old Tableau extract (.tde), which can't be read; re-save the workbook in a recent Tableau to use .hyper.")
                    elif os.path.splitext(low)[1] in DATA_EXT and not low.startswith("__macosx"):
                        t = _to_temp(z, i)
                        temps.append(t)
                        files.append((t, os.path.basename(i.filename)))
        elif ext == ".twb":
            with open(path, "rb") as f:
                workbook = parse_twb(_safe_xml(f.read()))
            notes.append("A .twb holds only the workbook, not its data. Package it as a .twbx in Tableau (File → Export Packaged Workbook), or import the data separately.")
        elif ext == ".hyper":
            tables = _hyper_tables(path, p.max_rows)
        elif ext == ".pbix":
            product = "powerbi"
            tables, visuals, measures, n = _pbix(path, p.max_rows)
            notes += n
            workbook = {"sheets": visuals, "calculations": measures, "dashboards": [], "sources": []}
        else:
            raise EngineError("Choose a .twbx, .twb, .hyper or .pbix file.")
        ctx.progress(0.6, "Saving the tables")
        datasets = []
        for tname, df in tables:
            if df.empty:
                notes.append(f"Table “{tname}” is empty.")
                continue
            datasets.append(ctx.datasets.ingest_frame(df, f"{prefix} · {_clean_name(tname)}" if len(tables) > 1 else prefix,
                                                      {"kind": product, "file": filename, "table": tname}))
        for t, original in files:
            try:
                datasets.append(ctx.datasets.ingest_file(t, original, f"{prefix} · {os.path.splitext(original)[0]}", {"kind": product, "file": filename, "member": original}))
            except EngineError as err:
                notes.append(f"{original} couldn't be read: {err.message}")
    finally:
        for t in temps:
            if os.path.exists(t):
                os.unlink(t)

    # Which sheets can be drawn on the main table (the largest), with its own column names.
    main = max(datasets, key=lambda d: d.get("rows", 0)) if datasets else None
    lookup = {c["name"].lower(): c["name"] for c in (main or {}).get("columns", [])}
    components, kpis = [], []
    for s in workbook["sheets"]:
        if not s.get("chart"):
            continue
        cols = [lookup.get(c.lower()) for c in s["columns"]]
        if main is None:
            s.update(status="skipped", note="no data to draw it on")
        elif s["chart"] == "KPI Cards":
            kpis += [c for c in cols if c]
        elif all(cols):
            components.append({"type": s["chart"], "columnsToUse": cols, "title": s["name"], "questionAnswered": f"From the {('Tableau' if product == 'tableau' else 'Power BI')} sheet “{s['name']}”."})
        else:
            missing = [c for c, m in zip(s["columns"], cols) if not m]
            s.update(status="skipped", note=f"uses {', '.join(missing)}, which isn't a column of the imported data (a calculated field or another table)")
    if kpis:
        components.insert(0, {"type": "KPI Cards", "columnsToUse": kpis[:4], "title": "Cards"})
    count = lambda items, st: sum(1 for x in items if x.get("status") == st)  # noqa: E731
    sheets, calcs = workbook["sheets"], workbook["calculations"]
    return {
        "product": product, "file": filename, "datasets": datasets, "dataset": main,
        "design": {"recommendedComponents": components, "topKPIs": kpis[:4], "layout": "2-col", "detectedProblem": f"{prefix} ({'Tableau' if product == 'tableau' else 'Power BI'})"} if components else None,
        "sheets": sheets, "calculations": calcs, "dashboards": workbook["dashboards"], "sources": workbook["sources"],
        "summary": {"tables": len(datasets), "sheets": len(sheets), "sheetsConverted": count(sheets, "converted"), "sheetsApproximated": count(sheets, "approximated"),
                    "sheetsSkipped": count(sheets, "skipped"), "calculations": len(calcs), "calculationsConverted": count(calcs, "converted")},
        "notes": notes,
    }
