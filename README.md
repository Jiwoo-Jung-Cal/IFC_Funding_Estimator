# IFC_Funding_Estimator
IB Computer Science Internal Assessment Product

**Overview**
The IFC Funding Estimator is a standalone desktop application that predicts quarterly regional funding allocations using a trained machine learning model. The system uses historical investment data to generate data-driven funding recommendations through a simple and intuitive interface.

This release includes both Windows and macOS versions of the application.


**Files Included**
IFC_Funding_Estimator_Windows.exe
IFC_Funding_Estimator_Mac.dmg
README.txt


**System Requirements**
Windows
Windows 10 or later recommended

macOS
macOS 11 or later recommended
Supports both Apple Silicon and Intel Macs


**Installation and Use**

Windows
 1. Double-click IFC_Funding_Estimator_Windows.exe
 2. Your default browser will open automatically
 3. Enter project details and generate funding predictions

No additional software or Python installation is required.

macOS
 1. Double-click IFC_Funding_Estimator_Mac.dmg
 2. Drag the application into the Applications folder
 3. Open the application from Applications

If macOS displays a security warning:
Go to System Settings -> Privacy & Security -> Click “Open Anyway”


**Functionality**
The application allows users to:
 - Input regional and project information
 - Generate quarterly funding allocation predictions
 - Apply regional budget constraints
 - Log investment records


**Data Handling**
All calculations are performed locally on the user’s machine.
No internet connection is required.
No data is transmitted externally.


**Notes**
 - The application is fully self-contained and includes all required dependencies.
 - Initial startup may take a few seconds.
 - Ensure the application is closed before moving or deleting the file.


**Web version (Vercel)**
The repository also contains a web build of the estimator:

 - `public/` – the web interface (static HTML/CSS/JS). Budgets and the investment log are stored in the browser's local storage; use Export/Import to move them as CSV (same columns as the desktop `investment_log.csv`).
 - `api/index.py` – a stateless Flask API (`/api/predict`, `/api/project-types`, `/api/health`) that loads the same trained model and produces predictions identical to the desktop app.
 - `requirements.txt`, `vercel.json`, `.vercelignore` – deployment configuration. scikit-learn is pinned to 1.7.2, the version the model was trained with.

Run locally:

    pip install -r requirements.txt
    python api/index.py        # then open http://127.0.0.1:5001

Deploy: import the GitHub repository at vercel.com/new (no settings need changing) and every push redeploys automatically.


**Support**
For questions or technical issues, please contact the developer.
