"""Tableau and Power BI imports: the data, the sheets as a dashboard, calculations as KPI formulas."""
import datetime
import io
import json
import random
import sys
import types
import zipfile

import pandas as pd
import pytest
from conftest import run

TWB = """<?xml version='1.0' encoding='utf-8' ?>
<workbook source-build='2024.1.0' version='18.1'>
  <datasources>
    <datasource caption='Superstore' inline='true' name='federated.abc'>
      <connection class='federated'>
        <named-connections><named-connection name='hyper.1'><connection class='hyper' dbname='Data/Extracts/Extract.hyper'/></named-connection></named-connections>
        <relation connection='hyper.1' name='Extract' table='[Extract].[Extract]' type='table'/>
      </connection>
      <column caption='Profit Ratio' datatype='real' name='[Calculation_1]' role='measure' type='quantitative'>
        <calculation class='tableau' formula='SUM([Profit])/SUM([Sales])'/>
      </column>
      <column caption='Big Order' datatype='boolean' name='[Calculation_2]' role='dimension' type='nominal'>
        <calculation class='tableau' formula='IF [Sales] &gt; 300 THEN TRUE ELSE FALSE END'/>
      </column>
      <column caption='Sales per Customer' datatype='real' name='[Calculation_3]' role='measure' type='quantitative'>
        <calculation class='tableau' formula='{FIXED [Customer] : SUM([Sales])}'/>
      </column>
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name='Sales by Region'><table><panes><pane><mark class='Bar'/></pane></panes>
      <rows>[federated.abc].[sum:Sales:qk]</rows><cols>[federated.abc].[none:Region:nk]</cols></table></worksheet>
    <worksheet name='Sales over time'><table><panes><pane><mark class='Line'/></pane></panes>
      <rows>[federated.abc].[sum:Sales:qk]</rows><cols>[federated.abc].[tmn:Order Date:ok]</cols></table></worksheet>
    <worksheet name='Profit vs Sales'><table><panes><pane><mark class='Circle'/></pane></panes>
      <rows>[federated.abc].[sum:Profit:qk]</rows><cols>[federated.abc].[sum:Sales:qk]</cols></table></worksheet>
    <worksheet name='Share by Region'><table><panes><pane><mark class='Pie'><encodings><color column='[federated.abc].[none:Region:nk]'/></encodings></mark></pane></panes>
      <rows></rows><cols></cols></table></worksheet>
    <worksheet name='Ratio by Region'><table><panes><pane><mark class='Bar'/></pane></panes>
      <rows>[federated.abc].[usr:Calculation_1:qk]</rows><cols>[federated.abc].[none:Region:nk]</cols></table></worksheet>
    <worksheet name='Where'><table><panes><pane><mark class='Automatic'/></pane></panes>
      <rows>[federated.abc].[Latitude (generated)]</rows><cols>[federated.abc].[Longitude (generated)]</cols></table></worksheet>
  </worksheets>
  <dashboards><dashboard name='Overview'><zones><zone name='Sales by Region'/><zone name='Sales over time'/></zones></dashboard></dashboards>
</workbook>"""


def _hyper(path):
    from tableauhyperapi import (
        Connection,
        CreateMode,
        HyperProcess,
        Inserter,
        SqlType,
        TableDefinition,
        TableName,
        Telemetry,
    )

    with HyperProcess(telemetry=Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU) as hp:
        with Connection(hp.endpoint, str(path), CreateMode.CREATE_AND_REPLACE) as c:
            c.catalog.create_schema("Extract")
            td = TableDefinition(TableName("Extract", "Extract"), [
                TableDefinition.Column("Region", SqlType.text()), TableDefinition.Column("Order Date", SqlType.date()),
                TableDefinition.Column("Sales", SqlType.double()), TableDefinition.Column("Profit", SqlType.double()),
                TableDefinition.Column("Customer", SqlType.text())])
            c.catalog.create_table(td)
            rnd = random.Random(1)
            with Inserter(c, td) as ins:
                for i in range(200):
                    ins.add_row([["East", "West", "North", "South"][i % 4], datetime.date(2024, 1 + i % 12, 1 + i % 27),
                                 round(rnd.uniform(10, 500), 2), round(rnd.uniform(-50, 150), 2), f"C{i % 37}"])
                ins.execute()


def _upload(client, name, data):
    r = client.post("/v2/files/upload", files={"file": (name, data, "application/octet-stream")})
    assert r.status_code == 200, r.text
    return r.json()["file_id"]


@pytest.fixture(scope="module")
def twbx(tmp_path_factory):
    d = tmp_path_factory.mktemp("bi")
    _hyper(d / "Extract.hyper")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Superstore.twb", TWB)
        z.write(d / "Extract.hyper", "Data/Extracts/Extract.hyper")
        z.writestr("Data/Sources/targets.csv", "Region,Target\nEast,100\nWest,120\nNorth,90\nSouth,110\n")
        z.writestr("Data/Extracts/old.tde", b"not readable")
    return buf.getvalue()


def test_tableau_packaged_workbook(client, twbx):
    r = run(client, "connect.bi", file_id=_upload(client, "Superstore.twbx", twbx))
    assert r["product"] == "tableau" and r["summary"]["tables"] == 2
    main = r["dataset"]
    assert main["rows"] == 200 and {"Region", "Order Date", "Sales", "Profit", "Customer"} <= {c["name"] for c in main["columns"]}
    types = {c["name"]: c.get("type") or c.get("dtype") for c in main["columns"]}
    assert "date" in str(types["Order Date"]).lower() or "timestamp" in str(types["Order Date"]).lower(), types
    assert any(d["rows"] == 4 for d in r["datasets"])  # the bundled CSV
    sheets = {s["name"]: s for s in r["sheets"]}
    assert sheets["Sales by Region"] == {"name": "Sales by Region", "chart": "Bar Chart", "columns": ["Region", "Sales"], "status": "converted", "note": ""}
    assert sheets["Sales over time"]["chart"] == "Line Chart" and sheets["Sales over time"]["columns"] == ["Order Date", "Sales"]
    assert sheets["Profit vs Sales"]["chart"] == "Scatter Plot"
    assert sheets["Share by Region"]["chart"] == "Pie Chart"
    # A sheet on a calculated field can't be drawn from the raw table: it says so.
    assert sheets["Ratio by Region"]["status"] == "skipped" and "Profit Ratio" in sheets["Ratio by Region"]["note"]
    assert sheets["Where"]["status"] == "skipped" and "map" in sheets["Where"]["note"]
    types_ = [c["type"] for c in r["design"]["recommendedComponents"]]
    assert types_ == ["Bar Chart", "Line Chart", "Scatter Plot", "Pie Chart"]
    calcs = {c["name"]: c for c in r["calculations"]}
    assert calcs["Profit Ratio"]["kpi"] == "SUM([Profit])/SUM([Sales])"
    assert calcs["Big Order"]["status"] == "skipped" and "row-level" in calcs["Big Order"]["note"]
    assert "level-of-detail" in calcs["Sales per Customer"]["note"]
    assert r["dashboards"] == [{"name": "Overview", "sheets": ["Sales by Region", "Sales over time"]}]
    assert any(".tde" in n for n in r["notes"])


def test_twb_alone_and_bad_files(client):
    r = run(client, "connect.bi", file_id=_upload(client, "Only.twb", TWB.encode()))
    assert r["datasets"] == [] and r["summary"]["sheets"] == 6 and any("holds only the workbook" in n for n in r["notes"])
    assert all(s["status"] == "skipped" for s in r["sheets"])
    evil = b"<?xml version='1.0'?><!DOCTYPE x [<!ENTITY a 'aaaa'>]><workbook>&a;</workbook>"
    bad = client.post("/v2/run/connect.bi", json={"params": {"file_id": _upload(client, "evil.twb", evil)}, "mode": "sync"})
    assert bad.status_code == 400 and "entities" in bad.json()["detail"]
    assert client.post("/v2/files/upload", files={"file": ("data.csv", b"a\n1\n")}).status_code == 400


def test_dax_and_power_bi_layout():
    from engine.capabilities.bi_import import parse_pbix_layout, translate_dax

    assert translate_dax("SUM(Sales[Amount])") == ("SUM([Amount])", "")
    assert translate_dax("DIVIDE(SUM('Sales'[Profit]), SUM('Sales'[Amount]))")[0] == "(SUM([Profit])) / (SUM([Amount]))"
    assert translate_dax("COUNTROWS(Sales)")[0] == "COUNT()"
    assert translate_dax("DISTINCTCOUNT(Sales[Customer])")[0] == "COUNT_DISTINCT([Customer])"
    assert translate_dax("CALCULATE(SUM(Sales[Amount]), Sales[Region] = \"East\")")[0] is None
    assert "time intelligence" in translate_dax("TOTALYTD(SUM(Sales[Amount]), Dates[Date])")[1]
    layout = {"sections": [{"displayName": "Overview", "visualContainers": [
        {"config": json.dumps({"singleVisual": {"visualType": "clusteredColumnChart", "projections": {
            "Category": [{"queryRef": "Sales.Region"}], "Y": [{"queryRef": "Sum(Sales.Amount)"}]}}})},
        {"config": json.dumps({"singleVisual": {"visualType": "lineChart", "projections": {
            "Category": [{"queryRef": "Sales.Date"}], "Y": [{"queryRef": "Sum(Sales.Amount)"}]}}})},
        {"config": json.dumps({"singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "Sum(Sales.Amount)"}]}}})},
        {"config": json.dumps({"singleVisual": {"visualType": "slicer", "projections": {"Values": [{"queryRef": "Sales.Region"}]}}})},
        {"config": json.dumps({"singleVisual": {"visualType": "treemap", "projections": {
            "Group": [{"queryRef": "Sales.Region"}], "Values": [{"queryRef": "Sum(Sales.Amount)"}]}}})},
    ]}]}
    v = parse_pbix_layout(layout)
    assert [(x["chart"], x["columns"], x["status"]) for x in v] == [
        ("Bar Chart", ["Region", "Amount"], "converted"), ("Line Chart", ["Date", "Amount"], "converted"),
        ("KPI Cards", ["Amount"], "converted"), (None, ["Region"], "skipped"), ("Bar Chart", ["Amount"], "approximated")]


def test_power_bi_file_end_to_end(client, monkeypatch):
    # A .pbix needs Power BI to make; pbixray reads the real data model. Here a stand-in returns its tables and measures.
    class FakeRay:
        def __init__(self, path):
            self.tables = ["Sales", "LocalDateTable_1"]
            self.dax_measures = pd.DataFrame([{"TableName": "Sales", "Name": "Total", "Expression": "SUM(Sales[Amount])"},
                                              {"TableName": "Sales", "Name": "YTD", "Expression": "TOTALYTD(SUM(Sales[Amount]), Sales[Date])"}])

        def get_table(self, name):
            return pd.DataFrame({"Region": ["East", "West"] * 30, "Date": pd.date_range("2024-01-01", periods=60), "Amount": range(60)})

    monkeypatch.setitem(sys.modules, "pbixray", types.SimpleNamespace(PBIXRay=FakeRay))
    layout = {"sections": [{"displayName": "Page 1", "visualContainers": [
        {"config": json.dumps({"singleVisual": {"visualType": "clusteredBarChart", "projections": {
            "Category": [{"queryRef": "Sales.Region"}], "Y": [{"queryRef": "Sum(Sales.Amount)"}]}}})},
        {"config": json.dumps({"singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "Sum(Sales.Amount)"}]}}})}]}]}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Report/Layout", json.dumps(layout).encode("utf-16-le"))
        z.writestr("DataModel", b"compressed model")
    r = run(client, "connect.bi", file_id=_upload(client, "Sales.pbix", buf.getvalue()))
    assert r["product"] == "powerbi" and r["summary"]["tables"] == 1 and r["dataset"]["rows"] == 60  # the hidden date table is skipped
    assert [c["type"] for c in r["design"]["recommendedComponents"]] == ["KPI Cards", "Bar Chart"]
    assert {c["name"]: c["kpi"] for c in r["calculations"]} == {"Total": "SUM([Amount])", "YTD": None}
