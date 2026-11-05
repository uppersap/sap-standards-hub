# Guía de Uso del Auditor & Gestión del Servidor AWS EC2

> **Proyecto:** UpperSAP Architecture Standards Hub & AI Auditor  
> **Repositorio Oficial:** `https://github.com/uppersap/sap-standards-hub.git`  
> **Servidor AWS IA:** `http://3.17.128.28:11434` (Ollama + `qwen2.5-coder:1.5b`)

---

## 1. Cómo usarlo en SAP Business Application Studio (BAS) en BTP

Tus compañeros trabajando en SAP BAS no necesitan clonar repositorios ni instalar librerías. Todo corre mediante `npx` en el terminal de BAS:

### Paso 1: Abrir la terminal en BAS
1. En el menú superior de BAS: `Terminal` -> `New Terminal`.
2. Asegurarse de estar en la carpeta raíz del proyecto UI5 o CAP (ej. `/home/user/projects/mi-app-ui5`).

### Paso 2: Ejecutar la auditoría

* **Opción A: Auditoría estándar con informe Markdown:**
  ```bash
  npx git+https://github.com/uppersap/sap-standards-hub.git audit . --report
  ```

* **Opción B: Auditoría interactiva con Inteligencia Artificial (AWS):**
  ```bash
  export OLLAMA_HOST="http://3.17.128.28:11434"
  npx git+https://github.com/uppersap/sap-standards-hub.git audit . --ai
  ```
  *(Al ejecutar esto, BAS se conectará por internet al servidor AWS de UpperSAP, la IA diagnosticará los errores y presentará el menú interactivo para aplicar mejoras).*

* **Opción C: Auto-reparación automática de fallos:**
  ```bash
  npx git+https://github.com/uppersap/sap-standards-hub.git audit . --fix --report
  ```

---

## 2. Cómo usarlo en Máquinas Locales (Mac / Windows / VS Code)

Cualquier compañero en su máquina local puede ejecutar el mismo comando remoto:

```bash
cd /ruta/hacia/su-proyecto
export OLLAMA_HOST="http://3.17.128.28:11434"
npx git+https://github.com/uppersap/sap-standards-hub.git audit . --ai
```

O si tienen clonado `sap-standards-hub` al lado de sus proyectos:
```bash
node ../sap-standards-hub/cli/bin/sap-audit.js . --ai
```

---

## 3. Matriz de Pruebas Rápidas (Test Cases)

| Caso de Prueba | Comando a Ejecutar | Resultado Esperado |
| :--- | :--- | :--- |
| **Test 1: Diagnóstico con IA** | `node sap-audit.js . --ai` | Muestra checklist, conecta con AWS, imprime explicación de la IA y abre menú interactivo `[1-4]`. |
| **Test 2: Generar Reporte** | `node sap-audit.js . --report` | Genera archivo `AUDIT_REPORT.md` en el proyecto con score y diffs de código. |
| **Test 3: Auto-Fix** | `node sap-audit.js . --fix` | Corrige sintaxis (ej. caracteres sueltos en XML) y eleva la puntuación al 100/100. |
| **Test 4: Integración CI/CD** | `node sap-audit.js . --strict` | Sale con código `0` si todo está perfecto o `1` si hay fallos (ideal para bloquear Pull Requests). |

---

## 4. Gestión del Servidor AWS EC2 (Cómo Apagar y Ahorrar Costos)

Para que el servidor en AWS no consuma horas ni recursos cuando nadie lo esté usando (por ejemplo en noches o fines de semana), se puede **Detener (Stop)** y **Encender (Start)** en 2 clics.

### A. Cómo Apagar el Servidor EC2 (Detenerlo):
1. Entra a la consola de AWS: [https://console.aws.amazon.com/ec2](https://console.aws.amazon.com/ec2).
2. Ve a **Instancias** en el menú izquierdo.
3. Selecciona tu instancia `uppersap-ai-auditor` (`i-0e4f8eea9a94adace`).
4. Haz clic arriba en el botón **Estado de la instancia** -> **Detener instancia** (*Stop instance*).
5. **¡Listo!** El cómputo (CPU y RAM) se detiene de inmediato y el costo pasa a **\$0**.
   *(Los archivos, el sistema operativo y el modelo de IA descargado permanecen intactos en el disco).*

> ⚠️ **NUNCA hagas clic en "Terminar instancia" (Terminate)**, ya que eso borraría la máquina virtual por completo. Solo usa **"Detener instancia"**.

### B. Cómo Volver a Encender el Servidor:
1. En la consola de AWS -> **Instancias**.
2. Selecciona la instancia.
3. Haz clic en **Estado de la instancia** -> **Iniciar instancia** (*Start instance*).
4. Espera 30 segundos a que esté en verde (**En ejecución**). Ollama arrancará automáticamente solo.

---

## 5. Nota Importante sobre la Dirección IP al Apagar

Por defecto en AWS, cuando una máquina se **Detiene** y se vuelve a **Iniciar**, AWS le asigna una nueva IP pública.

### Cómo evitar que la IP cambie (Asignar una IP Fija / Elastic IP):
Para que la IP nunca cambie aunque apagues y prendas la máquina:
1. En la consola de AWS EC2, en el menú lateral izquierdo ve a **Red y seguridad** -> **IP elásticas** (*Elastic IPs*).
2. Haz clic en **Asignar dirección IP elástica** -> **Asignar**.
3. Selecciona la IP recién creada -> **Acciones** -> **Asociar dirección IP elástica**.
4. En **Instancia**, elige tu máquina `uppersap-ai-auditor` y confirma.
5. ¡Listo! A partir de ese momento tendrás una IP permanente para siempre.

