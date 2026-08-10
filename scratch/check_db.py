import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    url = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"
    engine = create_async_engine(url)
    
    async with engine.connect() as conn:
        # Get active queries/connections
        query = text("""
            SELECT pid, age(clock_timestamp(), query_start), usename, state, query, wait_event_type, wait_event
            FROM pg_stat_activity
            WHERE query NOT LIKE '%pg_stat_activity%'
            ORDER BY age DESC;
        """)
        res = await conn.execute(query)
        rows = res.fetchall()
        print("--- All Connections/Queries ---")
        for r in rows:
            print(f"PID: {r[0]} | Age: {r[1]} | User: {r[2]} | State: {r[3]} | Wait Type: {r[5]} | Wait Event: {r[6]}")
            print(f"Query: {r[4][:200]}")
            print("-" * 50)
            
        print("\n--- Locks ---")
        query_locks = text("""
            SELECT 
                blocked_locks.pid     AS blocked_pid,
                blocked_activity.usename  AS blocked_user,
                blocking_locks.pid    AS blocking_pid,
                blocking_activity.usename AS blocking_user,
                blocked_activity.query    AS blocked_statement,
                blocking_activity.query   AS current_statement_in_blocking_process
            FROM  pg_catalog.pg_locks         blocked_locks
            JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
            JOIN pg_catalog.pg_locks         blocking_locks 
                ON blocking_locks.locktype = blocked_locks.locktype
                AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
                AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
                AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
                AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
                AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
                AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
                AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
                AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
                AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
                AND blocking_locks.pid != blocked_locks.pid
            JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
            WHERE NOT blocked_locks.granted;
        """)
        res_locks = await conn.execute(query_locks)
        locks = res_locks.fetchall()
        for l in locks:
            print(f"Blocked PID: {l[0]} ({l[1]}) blocked by Blocking PID: {l[2]} ({l[3]})")
            print(f"Blocked Query: {l[4][:200]}")
            print(f"Blocking Query: {l[5][:200]}")
            print("-" * 50)

if __name__ == "__main__":
    asyncio.run(main())
