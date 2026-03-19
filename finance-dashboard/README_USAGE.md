# Jay's Finance Dashboard - Usage Guide

This dashboard is a custom-built HTML5 application designed for premium financial tracking.

## 🚀 Getting Started

1.  **Open the Application**:
    Navigate to the `dist` folder and open `index.html` in your favorite web browser:
    `/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-dashboard/dist/index.html`

2.  **Authentication (API Key)**:
    - On your first visit, the app will prompt you for a **Google Sheets API Key**.
    - This key is stored securely in your browser's `localStorage` and never leaves your machine.
    - To get a key: Go to [Google Cloud Console](https://console.cloud.google.com/), enable "Google Sheets API", and create a credential (API Key).

3.  **Spreadsheet Sync**:
    - The app is pre-configured with your Spreadsheet IDs.
    - Make sure your Google Sheets have **Link Sharing** turned on (Anyone with the link can view) for the API Key to access them without OAuth.

## 📊 Features

- **Gasto Hormiga (Live)**: Automatically detects small recurring expenses based on keywords (`Oxxo`, `Cigarros`, `Starbucks`, etc.).
- **Payment Tracker**: Cross-references your "Gastos Fijos" sheet with your daily log to mark items as **PAGADO** or **PENDIENTE**.
- **Interactive Charts**: Hover over the ApexChart to see your spending trend by day.

## 🛠 Maintenance
- To change keywords for Gasto Hormiga, edit `main.js` in the `src` folder and run `npm run build`.
