import asyncio
from app.core.database import AsyncSessionLocal
from app.core.models import Dashboard, User, KPIField, KPI
from app.widget_data.service import evaluate_kpi_scalar_formula_field
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        ures = await db.execute(select(User).limit(1))
        test_user = ures.scalar_one()

        f_mock = KPIField(
            id=99999,
            kpi_id=273,
            key="mock_avg_score",
            name="Mock Avg Score",
            field_type="formula",
            formula_expression="AVG_ITEMS('qec_faculty_performance', 'score_out_of_100')",
            config={"is_formula": True, "formula_expression": "AVG_ITEMS('qec_faculty_performance', 'score_out_of_100')"}
        )

        # Unfiltered evaluation
        res_unfiltered = await evaluate_kpi_scalar_formula_field(
            db, 3, 273, 2026, None, f_mock, None, user=test_user
        )
        print("Scalar Formula (Unfiltered):", res_unfiltered)

        # Filtered by FALL 2025
        col_filter_fall = {"kpi_id": 273, "source_field_key": "qec_faculty_performance", "column_key": "semester", "value": "FALL 2025"}
        res_fall = await evaluate_kpi_scalar_formula_field(
            db, 3, 273, 2026, None, f_mock, None, column_filter=col_filter_fall, user=test_user
        )
        print("Scalar Formula (FALL 2025):", res_fall)

        # Filtered by SPRING 2026
        col_filter_spring = {"kpi_id": 273, "source_field_key": "qec_faculty_performance", "column_key": "semester", "value": "SPRING 2026"}
        res_spring = await evaluate_kpi_scalar_formula_field(
            db, 3, 273, 2026, None, f_mock, None, column_filter=col_filter_spring, user=test_user
        )
        print("Scalar Formula (SPRING 2026):", res_spring)

        # Test cross-KPI formula: COUNT_KPI_ITEMS_WHERE on KPI 273 from another KPI
        f_cross_mock = KPIField(
            id=99998,
            kpi_id=278,
            key="mock_cross_count",
            name="Mock Cross Count",
            field_type="formula",
            formula_expression="COUNT_KPI_ITEMS_WHERE(273, 'qec_faculty_performance', 'semester', 'op_eq', 'FALL 2025')",
            config={"is_formula": True, "formula_expression": "COUNT_KPI_ITEMS_WHERE(273, 'qec_faculty_performance', 'semester', 'op_eq', 'FALL 2025')"}
        )
        res_cross = await evaluate_kpi_scalar_formula_field(
            db, 3, 278, 2026, None, f_cross_mock, None, column_filter=col_filter_fall, user=test_user
        )
        print("Cross-KPI Scalar Formula (Filtered FALL 2025):", res_cross)

if __name__ == '__main__':
    asyncio.run(main())
