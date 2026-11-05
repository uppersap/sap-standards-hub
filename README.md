# SAP Architecture & Standards Hub (`@uppersap/sap-standards`)

> **Corporate Architecture Standards as Code**: Versioned specifications, AI agent guidelines, and automated auditor CLI for SAP UI5, CAP, and ABAP Cloud projects.
> Works identically across **Local Developer Machines (VS Code / Antigravity / Cursor)** and **SAP Business Application Studio (BAS) on BTP**.

---

## 1. Directory Structure Overview

```text
sap-standards-hub/
├── package.json                         # Versioned package descriptor & CLI registration
├── README.md                            # Corporate documentation & usage guide
├── cli/
│   └── bin/
│       └── sap-audit.js                 # Zero-dependency static auditor executable
├── standards/                           # Versioned Markdown Standards
│   ├── ui5/
│   │   ├── odata-v2/
│   │   │   └── v1.0.0.md                # UI5 with OData V2 & BaseController Standard
│   │   └── local-json/
│   │       └── v1.0.0.md                # UI5 with In-Memory JSONModel Standard
│   ├── cap/
│   │   └── nodejs/
│   │       └── v1.0.0.md                # CAP Node.js Service Architecture Standard
│   └── abap/
│       └── rap/
│           └── v1.0.0.md                # ABAP Cloud & RAP BO Development Standard
└── ai-templates/                        # Templates for Copilot / Antigravity / Joule
    └── copilot-instructions.md
```

---

## 2. How to Run in Different Environments

### 🚀 A. On SAP Business Application Studio (BAS)
In SAP BAS, open a Terminal (`Terminal -> New Terminal`) and run directly against any project:

```bash
# 1. Audit current project:
node /path/to/sap-standards-hub/cli/bin/sap-audit.js .

# 2. Audit and generate Markdown report:
node /path/to/sap-standards-hub/cli/bin/sap-audit.js ./my-ui5-app --report

# 3. If published to corporate Git, anyone in BAS can run with npx without installing:
npx git+https://github.com/tu-empresa/sap-standards-hub.git audit .
```

### 💻 B. On Local Machine (VS Code / Antigravity)
```bash
# Run using npm scripts from the hub:
npm run audit:master-data-ui5
npm run audit:master-data-cap
npm run audit:management-ui5

# Or run directly on any directory:
node cli/bin/sap-audit.js ../mi-nuevo-proyecto --report
```

### 🤖 C. Continuous Integration (CI/CD Pipeline)
Add to your GitHub Actions / GitLab CI before allowing merge:
```yaml
- name: Run SAP Architecture Audit
  run: node sap-standards-hub/cli/bin/sap-audit.js ./webapp --strict
```
*(With `--strict`, the process exits with code 1 if any failure or warning is detected, preventing non-compliant code from merging).*

---

## 3. How to Evolve & Version Standards (Semantic Versioning)

1. **Bug fixes or minor clarifications in standards:**
   - Update `standards/<tech>/<subtech>/v1.0.0.md` or increment to `v1.1.0.md`.
2. **Major paradigm shifts (Breaking changes):**
   - Example: Migrating from UI5 JavaScript to **UI5 TypeScript** or OData V2 to **OData V4**.
   - Create `standards/ui5/odata-v4/v2.0.0.md` or `standards/ui5/typescript/v2.0.0.md`.
   - Update `package.json` version to `2.0.0`.
   - Projects can specify which version of the standard they target:
     ```json
     {
       "sapStandards": { "tech": "ui5-odata-v2", "version": "1.0.0" }
     }
     ```

---

## 4. How to Add New Technologies (ABAP, CPI, etc.)

1. Create a dedicated folder under `standards/`:
   - e.g. `standards/abap/rap/v1.0.0.md` *(Template already included!)*
   - e.g. `standards/integration/cpi/v1.0.0.md`
2. Define the architectural rules, file naming conventions, and anti-hallucination checklists.
3. Add verification checks in `cli/bin/sap-audit.js` under `auditABAP()` or `auditIntegration()`.
4. Commit and push: All team members and AI tools instantly receive the updated standard.

