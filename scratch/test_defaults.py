import sys
import os
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

async def test_backend_defaults():
    print("Testing backend defaulting logic...")
    
    # Mocking imports and database objects
    from app.reports.custom_service import generate_custom_report_data
    from app.reports.service import generate_report_data
    
    mock_db = AsyncMock()
    mock_report = MagicMock()
    mock_report.id = 1
    mock_report.organization_id = 3
    mock_report.fetch_data_with_date = True
    
    # Mock get_custom_report
    with patch("app.reports.custom_service.get_custom_report", return_value=mock_report):
        # We also need to mock DB queries inside generate_custom_report_data
        # Let's mock resolve_date_range_for_period to return dummy dates
        with patch("app.widget_data.service.resolve_date_range_for_period", return_value=(MagicMock(year=2025), MagicMock(), 2026)):
            # Mock Organization select query
            mock_org = MagicMock()
            mock_org.id = 3
            mock_org.time_dimension = "yearly"
            
            mock_db_res = MagicMock()
            mock_db_res.scalar_one_or_none = AsyncMock(return_value=mock_org)
            mock_db.execute = AsyncMock(return_value=mock_db_res)
            
            # Since generate_custom_report_data will proceed to fetch KPIs, etc.,
            # we can capture the local variables or return value.
            # But let's check: if we pass year=None and by_default=True,
            # what happens to selected_period?
            # We can mock _topological_sort_report_kpis and bulk_load_org_kpi_values
            # to let it return an empty report quickly.
            with patch("app.reports.custom_service._topological_sort_report_kpis", return_value=[]):
                res = await generate_custom_report_data(
                    mock_db, id=1, org_id=3, year=None, include_drafts=False, by_default=True
                )
                print("Generated Custom Report Data Response:", res)
                assert res is not None
                assert res["year"] == "2025/26"
                print("Default year is correctly returned as 2025/26!")

if __name__ == "__main__":
    asyncio.run(test_backend_defaults())
