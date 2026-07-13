"""Generate sample workbooks for testing the platform."""

import argparse
from datetime import datetime, timedelta
from pathlib import Path

import polars as pl


def generate_rows(count: int, prefix: str, partner: str) -> pl.DataFrame:
    base_date = datetime(2024, 1, 1)
    rows = []
    for i in range(count):
        pid = f"{prefix}{i+1:05d}"
        d = base_date + timedelta(days=i % 90)
        connected = i % 3 != 0
        rows.append({
            "Prospect ID": pid,
            "Name": f"Lead {pid}",
            "Email": f"{pid.lower()}@example.com",
            "Phone": f"98{10000000 + i}",
            "Contact Stage": ["Never Dialed", "1 Dial", "2 Dial", "3+ Dial"][i % 4],
            "Main Lead Stages": ["Lead", "MQL", "SQL"][i % 3],
            "Partner (Auto)": partner,
            "State": ["Maharashtra", "Karnataka", "Delhi", "Gujarat"][i % 4],
            "City": ["Mumbai", "Bangalore", "New Delhi", "Ahmedabad"][i % 4],
            "Date": d.strftime("%Y-%m-%d"),
            "Month": d.strftime("%Y-%m"),
            "Total Dialed Count": i % 5,
            "Connected": connected,
            "MQL": connected and i % 2 == 0,
            "SQL": connected and i % 4 == 0,
            "Application": i % 10 == 0,
            "Test Registration": i % 15 == 0,
            "Offer Letter": i % 20 == 0,
            "Admission": i % 30 == 0,
            "Persona": ["Know More", "Application Started", "Test Registered"][i % 3],
            "Source": ["Google", "Facebook", "Organic"][i % 3],
            "Medium": ["CPC", "Social", "Direct"][i % 3],
            "Campaign": f"Campaign-{i % 5}",
            "Device": ["Mobile", "Desktop"][i % 2],
            "AI Status": ["Called", "Qualified", ""][i % 3],
            "Revenue": 50000 if i % 30 == 0 else 0,
            "Partner Cost": 1000 + (i % 10) * 100,
        })
    return pl.DataFrame(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="./sample-data")
    parser.add_argument("--rows", type=int, default=500)
    args = parser.parse_args()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    partners = ["Partner A", "Partner B", "Partner C"]
    for i, partner in enumerate(partners):
        df = generate_rows(args.rows, f"W{i+1}-", partner)
        path = out / f"Workbook_{i+1}.csv"
        df.write_csv(path)
        print(f"Created {path} ({df.height} rows)")

    print(f"\nUpload all files from {out} via the Upload Data page.")


if __name__ == "__main__":
    main()
