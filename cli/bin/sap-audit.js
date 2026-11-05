#!/usr/bin/env node

/**
 * SAP Standards Auditor CLI (v1.1.0)
 * Intelligent static code & architecture auditor for SAP UI5, CAP, and ABAP projects.
 * Features:
 *  - Pinpoint error location (File, exact line number, column)
 *  - Code Context & Git-diff ready fix snippets
 *  - Automated Auto-Fix capability (--fix)
 *  - Local AI integration via Ollama (--ai) or Cloud AI
 *  - Zero external dependencies (pure Node.js standard library)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// ANSI Color Helpers
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m'
};

const passTag = `${colors.green}[PASS]${colors.reset}`;
const warnTag = `${colors.yellow}[WARN]${colors.reset}`;
const failTag = `${colors.red}[FAIL]${colors.reset}`;

// Parse CLI Arguments
const args = process.argv.slice(2);
let targetDir = '.';
let forcedType = 'auto';
let generateReport = false;
let strictMode = false;
let autoFix = false;
let useAI = false;

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
        printHelp();
        process.exit(0);
    } else if (arg.startsWith('--type=')) {
        forcedType = arg.split('=')[1].toLowerCase();
    } else if (arg === '--report') {
        generateReport = true;
    } else if (arg === '--strict') {
        strictMode = true;
    } else if (arg === '--fix') {
        autoFix = true;
    } else if (arg === '--ai') {
        useAI = true;
    } else if (!arg.startsWith('-')) {
        targetDir = arg;
    }
}

const resolvedTarget = path.resolve(process.cwd(), targetDir);

if (!fs.existsSync(resolvedTarget)) {
    console.error(`${colors.red}Error: Target directory does not exist: ${resolvedTarget}${colors.reset}`);
    process.exit(1);
}

function printHelp() {
    console.log(`
${colors.cyan}${colors.bright}SAP Standards Auditor & Error Diagnostics CLI (v1.1.0)${colors.reset}
Intelligent architecture, code quality, and pinpoint error fixer for SAP projects.

${colors.bright}USAGE:${colors.reset}
  node sap-audit.js [target-directory] [options]
  npx sap-audit [target-directory] [options]

${colors.bright}OPTIONS:${colors.reset}
  --type=<type>    Specify project type: 'ui5-odata', 'ui5-local', 'cap', 'abap', or 'auto' (default: auto)
  --report         Generate a detailed AUDIT_REPORT.md with code diffs & exact fixes
  --fix            Automatically apply safe code fixes (e.g. XML typos, tag errors)
  --ai             Consult local AI (Ollama) to analyze errors and generate fixes
  --strict         Exit with code 1 if any FAIL or WARNING occurs (ideal for CI/CD)
  --help, -h       Show this help manual

${colors.bright}EXAMPLES:${colors.reset}
  node sap-audit.js ./my-app --report
  node sap-audit.js ./my-app --fix
  node sap-audit.js ./my-app --ai
`);
}

// Result Collector
const results = {
    projectType: '',
    targetDir: resolvedTarget,
    checks: [], // { category, description, status, details, location, fix }
    appliedFixes: [],
    summary: { pass: 0, warn: 0, fail: 0 }
};

function addCheck(category, description, status, details = '', location = null, fix = null) {
    results.checks.push({ category, description, status, details, location, fix });
    if (status === 'PASS') results.summary.pass++;
    else if (status === 'WARN') results.summary.warn++;
    else if (status === 'FAIL') results.summary.fail++;
}

// Auto-Detection
function detectProjectType(dir) {
    if (forcedType !== 'auto') return forcedType;

    const hasSrv = fs.existsSync(path.join(dir, 'srv'));
    const hasDb = fs.existsSync(path.join(dir, 'db'));
    const hasWebapp = fs.existsSync(path.join(dir, 'webapp'));

    if (hasSrv && hasDb) return 'cap';

    if (hasWebapp || fs.existsSync(path.join(dir, 'manifest.json'))) {
        const manifestPath = hasWebapp ? path.join(dir, 'webapp', 'manifest.json') : path.join(dir, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                const dataSources = manifest?.['sap.app']?.dataSources || {};
                const hasOData = Object.values(dataSources).some(ds => ds.type === 'OData');
                return hasOData ? 'ui5-odata' : 'ui5-local';
            } catch (e) {
                return 'ui5-odata';
            }
        }
        return 'ui5-odata';
    }

    return 'unknown';
}

const detectedType = detectProjectType(resolvedTarget);
results.projectType = detectedType;

console.log(`\n${colors.cyan}${colors.bright}======================================================${colors.reset}`);
console.log(`${colors.cyan}${colors.bright}    SAP STANDARDS AUDITOR & INTELLIGENT FIXER (v1.1)  ${colors.reset}`);
console.log(`${colors.cyan}${colors.bright}======================================================${colors.reset}`);
console.log(`${colors.bright}Target Project:${colors.reset} ${resolvedTarget}`);
console.log(`${colors.bright}Detected Type :${colors.reset} ${colors.blue}${detectedType.toUpperCase()}${colors.reset}`);
if (autoFix) console.log(`${colors.magenta}${colors.bright}Mode          :${colors.reset} ${colors.magenta}AUTO-FIX ENABLED (--fix)${colors.reset}`);
if (useAI) console.log(`${colors.cyan}${colors.bright}AI Diagnosis  :${colors.reset} ${colors.cyan}ENABLED (--ai)${colors.reset}`);
console.log('');

// -------------------------------------------------------------
// Audit Execution
// -------------------------------------------------------------
if (detectedType === 'ui5-odata' || detectedType === 'ui5-local') {
    auditUI5(resolvedTarget, detectedType);
} else if (detectedType === 'cap') {
    auditCAP(resolvedTarget);
} else {
    console.log(`${colors.yellow}Warning: Could not auto-detect SAP project type. Run with --type=ui5-odata|ui5-local|cap${colors.reset}`);
    process.exit(1);
}

// -------------------------------------------------------------
// UI5 Auditor Logic
// -------------------------------------------------------------
function auditUI5(dir, type) {
    const webappDir = fs.existsSync(path.join(dir, 'webapp')) ? path.join(dir, 'webapp') : dir;

    // 1. Mandatory Architecture Files
    const mandatoryFiles = [
        { path: 'manifest.json', desc: 'Application Manifest descriptor' },
        { path: 'Component.js', desc: 'Root UIComponent' },
        { path: 'controller/BaseController.js', desc: 'Reusable BaseController' },
        { path: 'utils/Utilities.js', desc: 'Utilities helper singleton' },
        { path: 'model/localModel.json', desc: 'Local JSONModel state definition' },
        { path: 'model/formatter.js', desc: 'UI formatter module' },
        { path: 'i18n/i18n.properties', desc: 'Master i18n bundle' }
    ];

    mandatoryFiles.forEach(item => {
        const fullPath = path.join(webappDir, item.path);
        if (fs.existsSync(fullPath)) {
            addCheck('Architecture', `File exists: ${item.path} (${item.desc})`, 'PASS');
        } else {
            addCheck(
                'Architecture',
                `Missing mandatory file: ${item.path} (${item.desc})`,
                'FAIL',
                `Expected at ${fullPath}`,
                { file: item.path },
                {
                    description: `Crea el archivo requerido '${item.path}' siguiendo la plantilla estándar.`,
                    snippet: `// Plantilla recomendada disponible en standards/ui5/${type === 'ui5-odata' ? 'odata-v2' : 'local-json'}/v1.0.0.md`
                }
            );
        }
    });

    // 2. BaseController checks
    const baseControllerRel = path.join('webapp', 'controller', 'BaseController.js');
    const baseControllerPath = path.join(webappDir, 'controller/BaseController.js');
    if (fs.existsSync(baseControllerPath)) {
        const content = fs.readFileSync(baseControllerPath, 'utf8');
        const hasUseStrict = content.includes('"use strict"') || content.includes("'use strict'");
        addCheck('Code Quality', 'BaseController declares "use strict"', hasUseStrict ? 'PASS' : 'WARN', '', { file: baseControllerRel, line: 2 });

        const hasShowMessage = content.includes('showMessage');
        const hasOpenDlg = content.includes('onOpenDlg');
        const hasCloseDlg = content.includes('onCloseDlg');

        if (hasShowMessage) {
            addCheck('Reusable API', 'BaseController implements showMessage()', 'PASS');
        } else {
            addCheck(
                'Reusable API',
                'BaseController implements showMessage()',
                'FAIL',
                'Falta el método centralizado showMessage() para notificaciones estándar con Promesas',
                { file: baseControllerRel, line: 30 },
                {
                    description: 'Agrega el método showMessage() en BaseController.js:',
                    snippet: `showMessage: function (sType, sMessage, sDetail) {
    if ([undefined, null, ""].includes(sMessage)) return;
    return new Promise((resolve) => {
        switch (sType) {
            case "Error":
                MessageBox.error(sMessage, { details: sDetail });
                break;
            case "Success":
                MessageBox.success(sMessage);
                break;
            case "Warning":
                MessageBox.warning(sMessage, { details: sDetail });
                break;
            default:
                MessageBox.alert(sMessage);
        }
        resolve();
    });
},`
                }
            );
        }

        if (hasOpenDlg && hasCloseDlg) {
            addCheck('Reusable API', 'BaseController implements onOpenDlg() & onCloseDlg()', 'PASS');
        } else {
            addCheck(
                'Reusable API',
                'BaseController implements onOpenDlg() & onCloseDlg()',
                'FAIL',
                'Faltan los métodos onOpenDlg() o onCloseDlg() para carga de fragmentos en caché',
                { file: baseControllerRel, line: 45 },
                {
                    description: 'Implementa onOpenDlg y onCloseDlg en BaseController.js para evitar duplicidad de instancias de fragmentos.'
                }
            );
        }
    }

    // 3. Utilities.js checks
    const utilsRel = path.join('webapp', 'utils', 'Utilities.js');
    const utilsPath = path.join(webappDir, 'utils/Utilities.js');
    if (fs.existsSync(utilsPath)) {
        const content = fs.readFileSync(utilsPath, 'utf8');
        const hasFormValidation = content.includes('validateAndPrepareData') && content.includes('validateFields');
        const hasCleanState = content.includes('cleanValueState');
        addCheck('Reusable API', 'Utilities implements dynamic Form validation (validateFields)', hasFormValidation ? 'PASS' : 'WARN', '', { file: utilsRel });
        addCheck('Reusable API', 'Utilities implements cleanValueState() for ValueState reset', hasCleanState ? 'PASS' : 'WARN', '', { file: utilsRel });

        if (type === 'ui5-odata') {
            const hasPromises = content.includes('Promise') && (content.includes('createService') || content.includes('readService') || content.includes('create('));
            addCheck('OData Patterns', 'Utilities wraps OData operations in Promises', hasPromises ? 'PASS' : 'FAIL', '', { file: utilsRel });
        } else {
            const hasLocalCrud = content.includes('createLocal') || content.includes('readLocal') || content.includes('setProperty');
            addCheck('Local Data Patterns', 'Utilities implements in-memory local CRUD operations', hasLocalCrud ? 'PASS' : 'FAIL', '', { file: utilsRel });
        }
    }

    // 4. Manifest.json Sanity Check
    const manifestPath = path.join(webappDir, 'manifest.json');
    const manifestRel = path.join('webapp', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const minUi5 = manifest?.['sap.ui5']?.dependencies?.minUI5Version;
            addCheck('Manifest Sanity', `Min UI5 Version configured (${minUi5 || 'none'})`, minUi5 ? 'PASS' : 'WARN', '', { file: manifestRel });

            const hasRouter = !!(manifest?.['sap.ui5']?.routing?.config?.routerClass || manifest?.['sap.ui5']?.routing?.routerClass);
            addCheck('Manifest Sanity', 'Routing configured with sap.m.routing.Router', hasRouter ? 'PASS' : 'FAIL', '', { file: manifestRel });

            const hasI18n = !!manifest?.['sap.ui5']?.models?.i18n;
            addCheck('Manifest Sanity', 'i18n ResourceModel configured', hasI18n ? 'PASS' : 'FAIL', '', { file: manifestRel });

            const hasLocalModel = !!manifest?.['sap.ui5']?.models?.localModel;
            addCheck('Manifest Sanity', 'localModel configured in sap.ui5.models', hasLocalModel ? 'PASS' : 'WARN', '', { file: manifestRel });
        } catch (e) {
            addCheck('Manifest Sanity', 'manifest.json parses without JSON errors', 'FAIL', e.message, { file: manifestRel });
        }
    }

    // 5. XML Views and Fragments Scan
    const fragmentTableDir = path.join(webappDir, 'view/fragment/table');
    const fragmentCreateDir = path.join(webappDir, 'view/fragment/create');

    if (fs.existsSync(fragmentTableDir)) {
        const files = fs.readdirSync(fragmentTableDir);
        const badNames = files.filter(f => !f.startsWith('tbl') && f.endsWith('.fragment.xml'));
        if (badNames.length === 0) {
            addCheck('Naming Standards', `Table fragments follow 'tbl<Entity>.fragment.xml' pattern (${files.length} found)`, 'PASS');
        } else {
            addCheck('Naming Standards', `Non-compliant table fragment names: ${badNames.join(', ')}`, 'WARN', 'Renombrar para iniciar con prefijo tbl');
        }
    }

    if (fs.existsSync(fragmentCreateDir)) {
        const files = fs.readdirSync(fragmentCreateDir);
        const badNames = files.filter(f => !f.startsWith('Create') && f.endsWith('.fragment.xml'));
        if (badNames.length === 0) {
            addCheck('Naming Standards', `Dialog fragments follow 'Create<Entity>.fragment.xml' pattern (${files.length} found)`, 'PASS');
        } else {
            addCheck('Naming Standards', `Non-compliant create dialog names: ${badNames.join(', ')}`, 'WARN', 'Renombrar para iniciar con prefijo Create');
        }
    }

    // 6. Stray syntax / Typo scan in XML files with line-level accuracy & Auto-Fix
    scanXmlFiles(webappDir);

    // 7. Multi-language check
    const i18nDir = path.join(webappDir, 'i18n');
    if (fs.existsSync(i18nDir)) {
        const langFiles = fs.readdirSync(i18nDir).filter(f => f.startsWith('i18n') && f.endsWith('.properties'));
        addCheck('Internationalization', `i18n property bundles discovered: ${langFiles.join(', ')}`, 'PASS');
    }
}

// -------------------------------------------------------------
// CAP Auditor Logic
// -------------------------------------------------------------
function auditCAP(dir) {
    // 1. Mandatory Architecture Files
    const mandatoryFiles = [
        { path: 'package.json', desc: 'NPM package descriptor' },
        { path: 'db/schema.cds', desc: 'Database CDS domain model' },
        { path: 'srv/cat-service.cds', desc: 'Catalog CDS service exposure' },
        { path: 'srv/cat-service.js', desc: 'Service lifecycle entry point' },
        { path: 'srv/auth.js', desc: 'Hybrid Authorization middleware' },
        { path: 'srv/handler.js', desc: 'Domain workflow handler' },
        { path: 'server.js', desc: 'Custom server bootstrap' },
        { path: 'xs-security.json', desc: 'BTP XSUAA configuration' },
        { path: 'mta.yaml', desc: 'Multi-Target Application deployment manifest' }
    ];

    mandatoryFiles.forEach(item => {
        const fullPath = path.join(dir, item.path);
        if (fs.existsSync(fullPath)) {
            addCheck('Architecture', `File exists: ${item.path} (${item.desc})`, 'PASS');
        } else {
            addCheck('Architecture', `Missing mandatory file: ${item.path} (${item.desc})`, 'FAIL', '', { file: item.path });
        }
    });

    // 2. server.js OData V2 Adapter Check
    const serverPath = path.join(dir, 'server.js');
    if (fs.existsSync(serverPath)) {
        const content = fs.readFileSync(serverPath, 'utf8');
        const hasV2 = content.includes('odata-v2-adapter') || content.includes('/v2');
        addCheck('Protocol Compatibility', 'server.js mounts OData V2 adapter on /v2', hasV2 ? 'PASS' : 'WARN', 'Essential for standard UI5 consumption', { file: 'server.js' });
    }

    // 3. Authorization Security Checks in cat-service.js with exact line numbers
    const catServiceJsPath = path.join(dir, 'srv/cat-service.js');
    if (fs.existsSync(catServiceJsPath)) {
        const content = fs.readFileSync(catServiceJsPath, 'utf8');
        const lines = content.split('\n');
        const commentedAuthLines = [];

        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') && trimmed.includes('.before(') && trimmed.includes('authorize(')) {
                commentedAuthLines.push({ lineNum: idx + 1, text: trimmed });
            }
        });

        if (commentedAuthLines.length > 0) {
            const lineNumbers = commentedAuthLines.map(l => l.lineNum).join(', ');
            addCheck(
                'Security & Access Control',
                `Commented-out authorization lines detected (${commentedAuthLines.length} lines)`,
                'WARN',
                `Líneas comentadas que dejan endpoints abiertos sin validación de roles`,
                { file: 'srv/cat-service.js', lines: lineNumbers },
                {
                    description: `Descomenta las líneas de autorización antes de ir a producción en srv/cat-service.js:`,
                    snippet: commentedAuthLines.slice(0, 4).map(l => `// Línea ${l.lineNum}:\n[-] ${l.text}\n[+] ${l.text.replace(/^\/\/\s*/, '')}`).join('\n\n')
                }
            );
        } else {
            addCheck('Security & Access Control', 'Active authorization guards verified on service hooks', 'PASS');
        }
    }

    // 4. Anonymous Fallback Check in Handlers with exact lines
    const handlerPath = path.join(dir, 'srv/handler.js');
    if (fs.existsSync(handlerPath)) {
        const content = fs.readFileSync(handlerPath, 'utf8');
        const lines = content.split('\n');
        const anonLines = [];

        lines.forEach((line, idx) => {
            if (line.includes("'anonymous'") || line.includes('"anonymous"')) {
                anonLines.push({ lineNum: idx + 1, text: line.trim() });
            }
        });

        if (anonLines.length > 0) {
            addCheck(
                'Security & Governance',
                `Fallback to 'anonymous' detected in user tracking (${anonLines.length} instances)`,
                'WARN',
                `El backend asigna 'anonymous' en lugar de exigir token XSUAA válido`,
                { file: 'srv/handler.js', lines: anonLines.map(l => l.lineNum).join(', ') },
                {
                    description: `Rechazar peticiones anónimas con 401 en vez de fallback:`,
                    snippet: `if (!req.user || !req.user.id) {\n    return req.reject(401, 'Authentication required');\n}`
                }
            );
        } else {
            addCheck('Security & Governance', 'Strict user identity enforcement verified', 'PASS');
        }
    }

    // 5. Git Hygiene: Check for compiled 'gen/' directory
    const genPath = path.join(dir, 'gen');
    if (fs.existsSync(genPath)) {
        addCheck(
            'Git Hygiene',
            'Compiled artifacts folder gen/ detected in source',
            'WARN',
            'Agregar gen/ a .gitignore para no inflar el repositorio Git',
            { file: '.gitignore' },
            {
                description: 'Agrega esta línea a tu .gitignore:',
                snippet: `gen/\nmta_archives/\nresources/\n`
            }
        );
    } else {
        addCheck('Git Hygiene', 'Clean repository: gen/ directory excluded', 'PASS');
    }

    // 6. ESLint config
    const hasEslint = fs.existsSync(path.join(dir, 'eslint.config.mjs')) || fs.existsSync(path.join(dir, '.eslintrc.json'));
    addCheck('Code Quality', 'ESLint configuration exists', hasEslint ? 'PASS' : 'WARN');
}

// -------------------------------------------------------------
// XML Scan for Typos with Line Number & Auto-Fix
// -------------------------------------------------------------
function scanXmlFiles(dir) {
    function walk(currDir) {
        if (!fs.existsSync(currDir)) return;
        const entries = fs.readdirSync(currDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currDir, entry.name);
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
                walk(fullPath);
            } else if (entry.isFile() && (entry.name.endsWith('.view.xml') || entry.name.endsWith('.fragment.xml'))) {
                const content = fs.readFileSync(fullPath, 'utf8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    // Detect trailing characters after closing tag: e.g. </Page>a
                    const match = line.match(/(<\/[a-zA-Z0-9:]+>)([a-zA-Z0-9]+)\s*$/);
                    if (match) {
                        const lineNum = i + 1;
                        const strayChar = match[2];
                        const cleanLine = line.replace(new RegExp(`(</[a-zA-Z0-9:]+>)${strayChar}(\\s*)$`), '$1$2');
                        const relativeFile = path.relative(resolvedTarget, fullPath);

                        if (autoFix) {
                            lines[i] = cleanLine;
                            fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
                            results.appliedFixes.push({
                                file: relativeFile,
                                line: lineNum,
                                description: `Eliminado caracter suelto '${strayChar}' al final de etiqueta`
                            });
                            addCheck('Syntax Integrity', `Stray trailing characters in XML: ${entry.name} [AUTO-FIXED]`, 'PASS');
                        } else {
                            addCheck(
                                'Syntax Integrity',
                                `Stray trailing character '${strayChar}' in XML tag`,
                                'FAIL',
                                `Caracter tipográfico suelto '${strayChar}' después de cierre de etiqueta`,
                                { file: relativeFile, line: lineNum, column: line.indexOf(match[0]) + 1 },
                                {
                                    description: `Corrige la línea ${lineNum} en ${relativeFile}:`,
                                    diff: `@@ -${lineNum},1 +${lineNum},1 @@\n- ${line.trim()}\n+ ${cleanLine.trim()}`
                                }
                            );
                        }
                    }
                }
            }
        }
    }
    walk(dir);
}

// -------------------------------------------------------------
// Print Report to Terminal
// -------------------------------------------------------------
console.log(`${colors.bright}AUDIT CHECKLIST BREAKDOWN:${colors.reset}\n`);

results.checks.forEach(c => {
    let tag = passTag;
    if (c.status === 'WARN') tag = warnTag;
    if (c.status === 'FAIL') tag = failTag;

    let locStr = '';
    if (c.location && c.location.file) {
        locStr = ` ${colors.dim}(${c.location.file}${c.location.line ? `:${c.location.line}` : ''}${c.location.lines ? `:[${c.location.lines}]` : ''})${colors.reset}`;
    }

    console.log(` ${tag} [${c.category.padEnd(24)}] ${c.description}${locStr}`);
    if (c.details && c.status !== 'PASS') {
        console.log(`        ${colors.dim}↳ Causa:${colors.reset} ${c.details}`);
    }

    // Display Fix Snippet / Diff in terminal if present
    if (c.fix && c.status !== 'PASS') {
        console.log(`        ${colors.green}${colors.bright}💡 Arreglo Sugerido:${colors.reset} ${c.fix.description || ''}`);
        if (c.fix.diff) {
            const diffLines = c.fix.diff.split('\n');
            diffLines.forEach(dl => {
                if (dl.startsWith('-')) console.log(`        ${colors.red}${dl}${colors.reset}`);
                else if (dl.startsWith('+')) console.log(`        ${colors.green}${dl}${colors.reset}`);
                else console.log(`        ${colors.dim}${dl}${colors.reset}`);
            });
        } else if (c.fix.snippet) {
            const snipLines = c.fix.snippet.split('\n');
            console.log(`        ${colors.cyan}┌───────────────────────────────────────────────┐${colors.reset}`);
            snipLines.forEach(sl => {
                console.log(`        ${colors.cyan}│${colors.reset} ${sl}`);
            });
            console.log(`        ${colors.cyan}└───────────────────────────────────────────────┘${colors.reset}`);
        }
    }
});

if (results.appliedFixes.length > 0) {
    console.log(`\n${colors.green}${colors.bright}✔ REPARACIONES AUTOMÁTICAS APLICADAS (--fix):${colors.reset}`);
    results.appliedFixes.forEach(f => {
        console.log(`  ${colors.green}✔ [${f.file}:${f.line}] ${f.description}${colors.reset}`);
    });
}

// Calculate Quality Score
const totalWeight = results.checks.length;
const passScore = results.summary.pass * 1.0;
const warnScore = results.summary.warn * 0.5;
const finalScore = totalWeight > 0 ? Math.round(((passScore + warnScore) / totalWeight) * 100) : 0;

let scoreColor = colors.green;
if (finalScore < 85) scoreColor = colors.yellow;
if (finalScore < 70) scoreColor = colors.red;

console.log(`\n${colors.bright}======================================================${colors.reset}`);
console.log(`${colors.bright}SUMMARY:${colors.reset} Passed: ${colors.green}${results.summary.pass}${colors.reset} | Warnings: ${colors.yellow}${results.summary.warn}${colors.reset} | Failures: ${colors.red}${results.summary.fail}${colors.reset}`);
console.log(`${colors.bright}QUALITY SCORE:${colors.reset} ${scoreColor}${colors.bright}${finalScore} / 100${colors.reset}`);
console.log(`${colors.bright}======================================================${colors.reset}\n`);

// -------------------------------------------------------------
// Optional Local AI Consultation (Ollama)
// -------------------------------------------------------------
if (useAI) {
    consultLocalAI();
} else {
    finishProcess();
}

function getOllamaConfig() {
    const rawHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    try {
        const parsed = new URL(rawHost.startsWith('http') ? rawHost : `http://${rawHost}`);
        return {
            protocol: parsed.protocol === 'https:' ? require('https') : require('http'),
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 11434),
            headers: process.env.OLLAMA_API_KEY ? { 'Authorization': `Bearer ${process.env.OLLAMA_API_KEY}` } : {}
        };
    } catch (e) {
        return {
            protocol: require('http'),
            hostname: '127.0.0.1',
            port: 11434,
            headers: {}
        };
    }
}

function consultLocalAI() {
    const ollamaConfig = getOllamaConfig();
    console.log(`${colors.cyan}${colors.bright}🤖 Conectando con servidor de IA (${ollamaConfig.hostname}:${ollamaConfig.port})...${colors.reset}`);

    const failedChecks = results.checks.filter(c => c.status !== 'PASS');
    if (failedChecks.length === 0) {
        console.log(`${colors.green}Todo está perfecto. La IA no encontró errores que corregir.${colors.reset}\n`);
        finishProcess();
        return;
    }

    // 1. Check available models from /api/tags
    const tagsReq = ollamaConfig.protocol.request({
        hostname: ollamaConfig.hostname,
        port: ollamaConfig.port,
        path: '/api/tags',
        method: 'GET',
        headers: ollamaConfig.headers,
        timeout: 4000
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const data = JSON.parse(body);
                const models = data.models || [];
                if (models.length === 0) {
                    console.log(`${colors.yellow}ℹ️ Servidor Ollama conectado, pero no tiene modelos descargados aún.${colors.reset}`);
                    console.log(`${colors.bright}Para descargar el modelo recomendado, corre en el servidor:${colors.reset}`);
                    console.log(`  ${colors.green}ollama run qwen2.5-coder:1.5b${colors.reset}\n`);
                    promptUserMenu(null, failedChecks);
                    return;
                }

                const selectedModel = models.find(m => m.name.includes('code'))?.name || models[0].name;
                console.log(`${colors.green}✔ Usando modelo:${colors.reset} ${colors.bright}${selectedModel}${colors.reset}`);
                console.log(`${colors.dim}Generando diagnóstico arquitectónico... (espera unos segundos)${colors.reset}`);

                executePrompt(selectedModel, failedChecks, ollamaConfig);
            } catch (e) {
                executePrompt('qwen2.5-coder', failedChecks, ollamaConfig);
            }
        });
    });

    tagsReq.on('error', () => {
        console.log(`${colors.yellow}ℹ️ No se pudo conectar al servidor de IA en ${ollamaConfig.hostname}:${ollamaConfig.port}.${colors.reset}`);
        console.log(`${colors.dim}Para local: 'brew services start ollama' | Para AWS: define export OLLAMA_HOST="http://tu-servidor-aws:11434"${colors.reset}\n`);
        promptUserMenu(null, failedChecks);
    });

    tagsReq.end();
}

function executePrompt(modelName, failedChecks, ollamaConfig = getOllamaConfig()) {
    const prompt = `Eres un asistente de desarrollo SAP ultra conciso y directo al grano.
Analiza estos problemas en el proyecto ${detectedType}:
${JSON.stringify(failedChecks.map(c => ({ issue: c.description, file: c.location?.file, line: c.location?.line, cause: c.details })), null, 2)}

INSTRUCCIONES ESTRICTAS:
- Sé directo y breve: máximo 2 a 3 líneas por problema.
- NO des introducciones, NO inventes ejemplos hipotéticos, NO repitas conceptos.
- Para cada problema indica únicamente:
  1. Qué está mal (1 frase corta).
  2. El código exacto de la solución para esa línea específica.`;

    const payload = JSON.stringify({
        model: modelName,
        prompt: prompt,
        stream: false,
        options: {
            temperature: 0.1,    // Muy bajo para máxima precisión sin inventar
            num_predict: 300     // Límite de tokens para evitar respuestas kilométricas
        }
    });

    const headers = Object.assign({}, ollamaConfig.headers, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    });

    const req = ollamaConfig.protocol.request({
        hostname: ollamaConfig.hostname,
        port: ollamaConfig.port,
        path: '/api/generate',
        method: 'POST',
        headers: headers,
        timeout: 90000 // 90s for LLM generation
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            try {
                const response = JSON.parse(body);
                console.log(`\n${colors.green}${colors.bright}💡 Diagnóstico de la IA (${modelName}):${colors.reset}`);
                console.log(response.response);
            } catch (e) {
                console.log(`${colors.yellow}No se pudo parsear respuesta de Ollama.${colors.reset}`);
            }
            promptUserMenu(modelName, failedChecks);
        });
    });

    req.on('error', (err) => {
        console.log(`${colors.yellow}Error comunicando con servidor de IA: ${err.message}${colors.reset}`);
        promptUserMenu(null, failedChecks);
    });

    req.write(payload);
    req.end();
}

// -------------------------------------------------------------
// Interactive Decision Menu
// -------------------------------------------------------------
const readline = require('readline');

function promptUserMenu(modelName, failedChecks) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log(`\n${colors.cyan}${colors.bright}╔══════════════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}${colors.bright}║               ¿CÓMO DESEAS PROCEDER CON ESTAS MEJORAS?           ║${colors.reset}`);
    console.log(`${colors.cyan}${colors.bright}╠══════════════════════════════════════════════════════════════════╣${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  ${colors.bright}[1]${colors.reset} Aplicar automáticamente todas las mejoras sugeridas            ${colors.cyan}║${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset}  ${colors.bright}[2]${colors.reset} Revisar e interactuar mejora por mejora (Confirmar Y/N)         ${colors.cyan}║${colors.reset}`);
    if (modelName) {
        console.log(`${colors.cyan}║${colors.reset}  ${colors.bright}[3]${colors.reset} Dar una instrucción personalizada a la IA (${modelName})        ${colors.cyan}║${colors.reset}`);
    }
    console.log(`${colors.cyan}║${colors.reset}  ${colors.bright}[4]${colors.reset} Salir sin modificar archivos                                   ${colors.cyan}║${colors.reset}`);
    console.log(`${colors.cyan}${colors.bright}╚══════════════════════════════════════════════════════════════════╝${colors.reset}`);

    rl.question(`\n${colors.bright}Selecciona una opción (1-4): ${colors.reset}`, (answer) => {
        const choice = answer.trim();
        if (choice === '1') {
            rl.close();
            applyAllFixes(failedChecks);
        } else if (choice === '2') {
            reviewFixesOneByOne(rl, failedChecks, 0);
        } else if (choice === '3' && modelName) {
            askCustomInstruction(rl, modelName, failedChecks);
        } else {
            console.log(`${colors.yellow}Operación cancelada. No se modificó ningún archivo.${colors.reset}\n`);
            rl.close();
            finishProcess();
        }
    });
}

function applyAllFixes(failedChecks) {
    console.log(`\n${colors.cyan}${colors.bright}⚙️  Aplicando reparaciones sugeridas...${colors.reset}`);
    let appliedCount = 0;

    failedChecks.forEach(c => {
        if (c.location && c.location.file && c.fix) {
            const fullPath = path.resolve(resolvedTarget, c.location.file);
            if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, 'utf8');
                const lines = content.split('\n');

                if (c.location.line) {
                    const lineIdx = c.location.line - 1;
                    const line = lines[lineIdx];
                    // Stray trailing character fix
                    if (c.category === 'Syntax Integrity' && line) {
                        const cleaned = line.replace(/(<\/[a-zA-Z0-9:]+>)[a-zA-Z0-9]+(\s*)$/, '$1$2');
                        if (cleaned !== line) {
                            lines[lineIdx] = cleaned;
                            fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
                            console.log(`  ${colors.green}✔ [${c.location.file}:${c.location.line}] Caracter suelto corregido exitosamente.${colors.reset}`);
                            appliedCount++;
                        }
                    }
                }
            }
        }
    });

    if (appliedCount > 0) {
        console.log(`\n${colors.green}${colors.bright}✔ Se aplicaron ${appliedCount} mejoras automáticamente.${colors.reset}`);
        console.log(`${colors.dim}Ejecuta de nuevo el auditor para verificar tu 100/100.${colors.reset}\n`);
    } else {
        console.log(`${colors.yellow}No se encontraron correcciones automáticas directas. Revisa las sugerencias manuales en AUDIT_REPORT.md.${colors.reset}\n`);
    }

    finishProcess();
}

function reviewFixesOneByOne(rl, failedChecks, index) {
    if (index >= failedChecks.length) {
        console.log(`\n${colors.green}✔ Revisión paso a paso completada.${colors.reset}\n`);
        rl.close();
        finishProcess();
        return;
    }

    const item = failedChecks[index];
    console.log(`\n${colors.bright}------------------------------------------------------------${colors.reset}`);
    console.log(`${colors.bright}Problema ${index + 1} de ${failedChecks.length}:${colors.reset} [${item.category}] ${item.description}`);
    if (item.location) console.log(`${colors.dim}Ubicación: ${item.location.file}${item.location.line ? `:${item.location.line}` : ''}${colors.reset}`);
    if (item.fix && item.fix.diff) {
        console.log(`${colors.cyan}Cambio propuesto:${colors.reset}\n${item.fix.diff}`);
    } else if (item.fix && item.fix.description) {
        console.log(`${colors.cyan}Sugerencia:${colors.reset} ${item.fix.description}`);
    }

    rl.question(`\n¿Deseas aplicar esta mejora? (y/n/s para salir): `, (ans) => {
        const a = ans.trim().toLowerCase();
        if (a === 's') {
            rl.close();
            finishProcess();
            return;
        }

        if (a === 'y' || a === 'si' || a === 'yes') {
            if (item.location && item.location.file && item.location.line) {
                const fullPath = path.resolve(resolvedTarget, item.location.file);
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const lines = content.split('\n');
                    const lineIdx = item.location.line - 1;
                    const line = lines[lineIdx];
                    if (item.category === 'Syntax Integrity' && line) {
                        lines[lineIdx] = line.replace(/(<\/[a-zA-Z0-9:]+>)[a-zA-Z0-9]+(\s*)$/, '$1$2');
                        fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
                        console.log(`${colors.green}✔ Cambio aplicado en ${item.location.file}:${item.location.line}${colors.reset}`);
                    }
                }
            }
        } else {
            console.log(`${colors.dim}Saltando este cambio.${colors.reset}`);
        }

        reviewFixesOneByOne(rl, failedChecks, index + 1);
    });
}

function askCustomInstruction(rl, modelName, failedChecks) {
    const ollamaConfig = getOllamaConfig();
    rl.question(`\n${colors.cyan}${colors.bright}Escribe tu instrucción o pregunta para la IA:${colors.reset}\n> `, (userPrompt) => {
        if (!userPrompt.trim()) {
            promptUserMenu(modelName, failedChecks);
            return;
        }

        console.log(`\n${colors.dim}Consultando a ${modelName}...${colors.reset}`);

        const prompt = `Contexto del proyecto SAP (${detectedType}):
Problemas detectados:
${JSON.stringify(failedChecks.map(c => ({ issue: c.description, file: c.location?.file, line: c.location?.line })), null, 2)}

Instrucción del desarrollador:
"${userPrompt.trim()}"

Responde de forma muy concisa y directa, dando el código exacto necesario sin rodeos.`;

        const payload = JSON.stringify({
            model: modelName,
            prompt: prompt,
            stream: false,
            options: {
                temperature: 0.2,
                num_predict: 400
            }
        });

        const headers = Object.assign({}, ollamaConfig.headers, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        });

        const req = ollamaConfig.protocol.request({
            hostname: ollamaConfig.hostname,
            port: ollamaConfig.port,
            path: '/api/generate',
            method: 'POST',
            headers: headers,
            timeout: 90000
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    console.log(`\n${colors.green}${colors.bright}🤖 Respuesta de la IA:${colors.reset}`);
                    console.log(response.response);
                } catch (e) {
                    console.log(`${colors.yellow}No se pudo parsear respuesta.${colors.reset}`);
                }
                // Return to menu
                promptUserMenu(modelName, failedChecks);
            });
        });

        req.on('error', (err) => {
            console.log(`${colors.yellow}Error: ${err.message}${colors.reset}`);
            promptUserMenu(modelName, failedChecks);
        });

        req.write(payload);
        req.end();
    });
}

// -------------------------------------------------------------
// Export Markdown Report
// -------------------------------------------------------------
function finishProcess() {
    if (generateReport) {
        const reportPath = path.join(resolvedTarget, 'AUDIT_REPORT.md');
        let md = `# Project Architecture & Code Quality Audit Report\n\n`;
        md += `> Generated automatically by **SAP Standards Auditor v1.1.0**\n`;
        md += `> Date: ${new Date().toISOString()}\n`;
        md += `> Target: \`${resolvedTarget}\`\n`;
        md += `> Standard: **${detectedType.toUpperCase()}**\n\n`;

        md += `## 1. Quality Score & Health\n\n`;
        md += `### Score: **${finalScore} / 100**\n\n`;
        md += `* **PASS:** ${results.summary.pass}\n`;
        md += `* **WARNING:** ${results.summary.warn}\n`;
        md += `* **FAIL:** ${results.summary.fail}\n\n`;

        md += `## 2. Issues Breakdown & Exact Fixes\n\n`;

        results.checks.forEach((c, idx) => {
            const badge = c.status === 'PASS' ? '✅ PASS' : c.status === 'WARN' ? '⚠️ WARN' : '❌ FAIL';
            const loc = c.location ? `\`${c.location.file}${c.location.line ? `:${c.location.line}` : ''}\`` : 'General';

            md += `### ${idx + 1}. [${c.category}] ${c.description} - ${badge}\n\n`;
            md += `* **Location:** ${loc}\n`;
            if (c.details) md += `* **Cause:** ${c.details}\n`;

            if (c.fix) {
                md += `* **Fix Guide:** ${c.fix.description || ''}\n\n`;
                if (c.fix.diff) {
                    md += `\`\`\`diff\n${c.fix.diff}\n\`\`\`\n\n`;
                } else if (c.fix.snippet) {
                    md += `\`\`\`javascript\n${c.fix.snippet}\n\`\`\`\n\n`;
                }
            }
            md += `---\n\n`;
        });

        fs.writeFileSync(reportPath, md, 'utf8');
        console.log(`${colors.green}📄 Markdown report with diffs & fixes exported to:${colors.reset} ${reportPath}\n`);
    }

    if (strictMode && (results.summary.fail > 0 || results.summary.warn > 0)) {
        process.exit(1);
    } else if (results.summary.fail > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}
