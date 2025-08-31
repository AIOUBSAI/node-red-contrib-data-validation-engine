# node-red-contrib-data-validation-engine

A lightweight rule-based validator for structured sheet-like data in Node-RED.
This build focuses on two common checks:

* **`sheetsExist`** — ensure specific sheets exist and are non-empty.
* **`sheetHasColumns`** — ensure a sheet exposes required columns/paths.

It supports:

* UI rule builder with an **Add/Edit** dialog
* Optional **JSON config file** (load/save/lock/watch)
* Simple **rule-level condition** (attr/op/rhs)
* Typed RHS (string/number/bool/msg/flow/global/env/jsonata)
* Status badge and a structured result on `msg.validation`

---

## Install

```bash
npm i node-red-contrib-data-validation-engine
# or inside your Node-RED userDir (usually ~/.node-red)
cd ~/.node-red
npm i node-red-contrib-data-validation-engine
```

Restart Node-RED. You’ll find the node under **function** as **data-validation**.

---

## Quick Start

1. Drop **data-validation** node in a flow.
2. Choose your **Input** source (`msg`, `flow`, or `global` + path).

   * Example: `msg.data` where `data` is an object:

     ```json
     {
       "NAME":[{...}],
       "PRICE":[{ "Project":"P1", "Layout":"L1" }]
     }
     ```
3. Add rules (dialog) or **Load from file**.
4. Wire a **debug** node and send any message.
5. Read results on `msg.validation`.

---

## Node Properties

### Input

* **Source**: `msg` | `flow` | `global`
* **Path**: dot-path under the chosen scope (e.g. `data`).
  The result must be an **object** keyed by sheet names (arrays or objects).

### Config file (optional)

* **Use config file**: toggle on to use a JSON file under your Node-RED `userDir`.
* **Path**: relative or absolute. Relative resolves under `userDir`.
* **Load from file**: reads JSON and populates the Rules table (and dialog).
* **Save to file**: writes the current UI rules to the JSON file.
* **Lock to file**: disables the rules UI and always uses the file on deploy/runtime.
* **Watch**: auto-reload rules when the file changes.

### Default level

* Fallback level for rules that do not specify one: `info` | `warning` | `error`.

---

## Rules

### 1) `sheetsExist`

Checks that each listed sheet exists and is non-empty.

```json
{
  "type": "sheetsExist",
  "id": "RULE_SHEETS",
  "description": "Core sheets exist",
  "requiredSheets": ["NAME","PRICE"],
  "level": "error",

  "conditions": {
    "and": [
      { "attribute": "TM", "operator": "==", "rhsType": "str", "value": "RTC" }
    ]
  }
}
```

### 2) `sheetHasColumns`

Checks headers/paths on the *shape* of the sheet (first object for arrays; object otherwise).

```json
{
  "type": "sheetHasColumns",
  "id": "RULE_LAYOUT_COLS",
  "description": "NAME must have name, grade",
  "sheet": "Layout",
  "requiredColumns": ["name","grade"],
  "level": "error",

  "conditions": {
    "and": [
      { "attribute": "SomeContext.Value", "operator": "regex", "rhsType": "str", "value": "^P" }
    ]
  }
}
```

#### Operators

`==`, `!=`, `contains`, `!contains`, `regex`, `isEmpty`, `!isEmpty`

#### RHS types

`str`, `num`, `bool`, `msg`, `flow`, `global`, `env`, `jsonata`

> Example `jsonata`: `$.now()` or mapping something derived from `msg`.

---

## Output

On success the node sets:

```json
msg.validation = {
  "logs": [
    {
      "id": "RULE_LAYOUT_COLS",
      "type": "sheetHasColumns",
      "level": "error|warning|info",
      "message": "Missing column 'name' in 'NAME'.",
      "description": "NAME must have name, grade"
    }
  ],
  "counts": { "info": 6, "warning": 1, "error": 2, "total": 9 }
}
```

The node status shows a compact summary: `E:x W:y I:z`.

---

## JSON Config File

If you prefer to keep rules in a file:

```json
[
  {
    "type": "sheetsExist",
    "description": "Core sheets exist",
    "requiredSheets": ["NAME","PRICE"],
    "level": "error"
  },
  {
    "type": "sheetHasColumns",
    "description": "NAME must have name, grade",
    "sheet": "NAME",
    "requiredColumns": ["name","grade"],
    "level": "error"
  }
]
```

* **Load from file** fills the UI with these rules.
* **Save to file** writes current UI rules back to the file.
* **Lock to file** forces runtime to read from file, disabling the local editor.

---

## Best Practices

* Feed the node a clean, **object-of-sheets** structure.
* For column checks, ensure the first row is representative (object with keys).
* Use **conditions** sparingly to gate rule execution.
* Keep rule IDs stable if you post-process `msg.validation.logs`.

---

## Troubleshooting

* **“invalid input root” status**: the configured `msg/flow/global` path doesn’t resolve to an object.
* **Config file not found**: path must be under `userDir` if relative; file must be `.json`.
* **No changes after editing file**: enable **Watch**, or hit **Deploy** to reload.

---

## License

MIT @AIOUB SAI

---

## Changelog

* **0.2.0** – First public release: sheetsExist & sheetHasColumns, UI builder, config file support, typed conditions.
