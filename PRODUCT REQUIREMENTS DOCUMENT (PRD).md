# **PRODUCT REQUIREMENTS DOCUMENT (PRD)**

# **Digital Partners Analytics Platform (v2)**

### **Enterprise Analytics Platform for upGrad School of Technology**

Version 2.0

---

# **1\. Executive Summary**

The current Google Sheets dashboard has reached its scalability limits.

Problems include

* Google Sheet row limitations  
* Formula recalculation delays  
* Multiple workbook management  
* Slow filtering  
* Broken references  
* Impossible to analyze millions of rows  
* Difficult dashboard maintenance

The proposed system replaces spreadsheet analytics with a modern web application capable of ingesting unlimited Excel/CSV files while treating them as one continuous dataset.

The uploaded workbooks become **logical partitions** instead of separate datasets.

The dashboard performs all calculations on the consolidated dataset.

---

# **Primary Goal**

User uploads

Workbook\_A.xlsx  
Workbook\_B.xlsx  
Workbook\_C.xlsx  
Workbook\_D.xlsx

Dashboard internally creates

MASTER DATASET

Workbook A  
\+  
Workbook B  
\+  
Workbook C  
\+  
Workbook D

\=

Unified Dataset

The user should never know which workbook contained which row.

Everything behaves like

SELECT \*  
FROM MASTER\_DATASET

---

# **2\. Objectives**

The platform should

✓ Accept unlimited Excel workbooks

✓ Accept CSV files

✓ Accept folders containing multiple files

✓ Merge every sheet automatically

✓ Detect duplicate Prospect IDs

✓ Handle millions of rows

✓ Refresh dashboards automatically

✓ Provide interactive BI dashboards

✓ Export reports

✓ Support drill-down analytics

✓ No manual formulas

---

# **3\. Target Users**

Operations Team

Partnership Team

Leadership

Marketing

Sales

Counselling Team

Management

---

# **4\. Supported Files**

Input

Excel (.xlsx)

Excel (.xls)

CSV

ZIP containing multiple Excel files

Example

January.xlsx  
February.xlsx  
March.xlsx

↓

Merged automatically

---

# **5\. Data Assumptions**

Every workbook contains identical columns.

Example

Prospect ID

Name

Email

Contact Stage

Main Lead Stages

Partner (Auto)

State

Date

Month

Total Dialed Count

Connected

etc.

Column names are fixed.

Only rows increase.

---

# **6\. Data Engine**

Instead of reading one workbook,

the system creates

Unified Data Engine

Workbook 1  
Workbook 2  
Workbook 3  
Workbook 4  
Workbook N

↓

Read

↓

Validate

↓

Normalize

↓

Append

↓

Master Dataset

↓

Analytics Engine

↓

Dashboard

---

# **7\. Upload Workflow**

User opens

Upload Data

Drag & Drop

Workbook A

Workbook B

Workbook C

System

Step 1

Validate columns

↓

Step 2

Check duplicates

↓

Step 3

Merge

↓

Step 4

Index

↓

Step 5

Refresh Dashboard

No manual refresh required.

---

# **8\. Data Processing Pipeline**

## **Validation**

Check

Required columns

Missing columns

Wrong datatype

Blank Prospect IDs

Invalid dates

Duplicate Prospect IDs

---

## **Cleaning**

Normalize

Partner Names

State Names

Contact Stage

Date Format

Trim spaces

Uppercase

Phone Number

---

## **Consolidation**

Append

Workbook A

↓

Workbook B

↓

Workbook C

↓

Workbook N

---

## **Derived Columns**

Automatically generate

Contactability

Dial Bucket

Week

Month

Quarter

Year

Lead Age

Partner Share

Conversion %

AI Contacted

Funnel Stage

Revenue

ROI

---

# **9\. Performance Requirements**

Current

500,000+

Target

20 Million+

Upload Time

\<30 sec

Dashboard Load

\<3 sec

Filter

\<500 ms

Charts

\<1 sec

Search

Instant

---

# **10\. Dashboard Structure**

The dashboard should have **multiple pages**.

---

# **Page 1**

Executive Dashboard

Purpose

Bird's Eye View

Contains

Top KPIs

Trend

Alerts

Pipeline

Partner Summary

AI Calling

Revenue

---

KPIs

Total Leads

Connected

Contactability

Never Dialed

MQL

SQL

Applications

Registrations

Offer Letters

Admissions

Revenue

ROI

AI Calls

Average Dial Count

DNP %

---

Charts

Daily Leads

Weekly Leads

Monthly Leads

Partner Comparison

Lead Sources

State Distribution

Call Distribution

Funnel

Heatmap

Contactability Trend

---

# **Page 2**

Lead Funnel

Shows

Lead

↓

Connected

↓

MQL

↓

SQL

↓

Application

↓

Test Registration

↓

Offer Letter

↓

Admission

Every stage

Conversion %

Drop %

Loss %

Partner Comparison

---

# **Page 3**

Partner Analytics

Every partner gets

Overview

Trend

Conversion

AI Calling

Revenue

Performance Score

Top States

Top Personas

Offer Letters

Applications

Admissions

---

# **Page 4**

Contactability Analytics

Never Dialed

1 Dial

2 Dial

3+

Average Dials

AI Performance

Call Attempts

Response %

---

# **Page 5**

AI Calling Dashboard

Calls

Qualified

Warm

High Intent

Payment Link

Brochure

DNP

Interested

Callback

AI Effectiveness

---

# **Page 6**

Persona Analytics

Know More

Application Started

Test Registered

Offer Letter

Fee Paid

Drop-off

Every Persona

Every Partner

---

# **Page 7**

Campaign Analytics

Source

Medium

Partner

Campaign

State

ROI

CPA

Applications

Admissions

---

# **Page 8**

Geographic Analytics

India Map

State

City

Heatmaps

Lead Density

Partner Penetration

Admissions

---

# **Page 9**

Revenue Dashboard

Revenue

Partner Cost

CPA

ROI

Profit

Break-even

Forecast

---

# **Page 10**

Predictive Analytics

Forecast

Admissions

Revenue

Lead Growth

Partner Growth

Expected ROI

---

# **11\. Universal Filters**

Visible on every page

Date

Week

Month

Quarter

Year

Partner

State

City

Persona

Lead Stage

Contact Stage

AI Status

Campaign

Source

Medium

Device

Search Prospect ID

---

# **12\. Drill Down**

Click

Partner

↓

State

↓

City

↓

Lead List

↓

Prospect

No page reload.

---

# **13\. Search**

Global Search

Prospect ID

Phone

Email

Partner

State

Instant Results

---

# **14\. Dashboard Cards**

Every KPI card shows

Current

Previous Period

Trend

Change %

Sparkline

Example

Connected

12,843

▲ 7.4%

Last Month

---

# **15\. Charts**

Modern

Interactive

Cross Filter

Zoom

Hover

Export

Supported

Line

Bar

Area

Heatmap

Treemap

Sankey

Waterfall

Funnel

Donut

Radar

Bubble

Scatter

Geo Map

Sunburst

---

# **16\. Export**

Current View

Excel

CSV

PDF

PNG

PowerPoint

---

# **17\. Alerts**

Automatic

Drop in Contactability

Partner Down

Admissions Low

Duplicate Upload

Missing Data

Data Quality Score

---

# **18\. Security**

Role Based Access

Admin

Operations

Management

Partner

Read Only

---

# **19\. Technology Recommendation**

Frontend

Next.js

React

TypeScript

TailwindCSS

Shadcn

Apache ECharts

AG Grid Enterprise

TanStack Table

Backend

Python FastAPI

DuckDB

Polars

PyArrow

SQLAlchemy

Storage

Parquet

SQLite (metadata)

or PostgreSQL

---

# **20\. Data Architecture**

Excel

CSV

Workbook A

Workbook B

Workbook C

↓

Upload Engine

↓

Validation

↓

Cleaning

↓

Deduplication

↓

Parquet Store

↓

DuckDB

↓

Analytics Engine

↓

REST API

↓

Dashboard

---

# **21\. UI Design System (upGrad Theme)**

## **Design Language**

**Style:** Enterprise • Industrial • Sharp • Data-first

### **Color Palette**

* **Primary Red:** `#E31E24` (upGrad Red)  
* **Background:** `#0F0F10`  
* **Surface:** `#1A1A1A`  
* **Panel:** `#202124`  
* **Borders:** `#3A3A3A`  
* **Text Primary:** `#FFFFFF`  
* **Text Secondary:** `#B5B5B5`  
* **Success:** `#22C55E`  
* **Warning:** `#F59E0B`  
* **Danger:** `#EF4444`  
* **Accent:** `#E31E24`

### **Visual Principles**

* **No rounded corners** (0–2px maximum)  
* Sharp rectangular KPI cards  
* Thin red divider lines  
* Dense information layout  
* Minimal shadows  
* Black and dark-gray surfaces  
* Red used only for highlights and important metrics  
* High-contrast typography  
* Monospaced numerals for KPIs  
* Hover states with subtle red outline

### **Layout**

* Fixed left navigation rail  
* Sticky top filter bar  
* Responsive 12-column grid  
* Resizable dashboard widgets  
* Full-screen chart mode  
* Keyboard-friendly navigation

---

# **22\. Scalability Goals**

| Metric | Target |
| ----- | ----- |
| Uploaded workbooks | Unlimited |
| CSV files | Unlimited |
| Rows | 20M+ |
| Concurrent users | 100+ |
| Dashboard load | \<3 seconds |
| Filter response | \<500 ms |
| Upload size | 5 GB+ |
| Duplicate detection | Automatic |
| Incremental refresh | Supported |
| Historical snapshots | Supported |

