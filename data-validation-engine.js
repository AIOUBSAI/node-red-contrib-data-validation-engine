/**
 * data-validation-engine (simplified: sheetsExist + sheetHasColumns)
 * ---------------------------------------------------------------
 * - Input source: msg/flow/global + path (no array scoping)
 * - Rules come from editor or an external JSON file (if enabled)
 * - Optional single condition per rule (attr/op/rhs)
 * - Output: msg.validation = { logs, counts }
 */

module.exports = function (RED) {

   // ===== Admin endpoints for Load/Save (drop-in) =====
  const fs = require("fs");
  const path = require("path");
  const fsp = require("fs/promises");
  const RULES_FILE_SUFFIX = ".json";

  function userDir(RED){ return RED.settings.userDir || process.cwd(); }
  function toUserAbs(RED, relOrAbs){
    if (!relOrAbs) return null;
    if (path.isAbsolute(relOrAbs)) return relOrAbs;
    return path.join(userDir(RED), relOrAbs);
  }
  function ensureJsonUnderUserDir(RED, p){
    if (!p || !p.endsWith(RULES_FILE_SUFFIX)) throw new Error("Path must end with .json");
    const abs = toUserAbs(RED, p);
    const u  = path.resolve(userDir(RED));
    const a  = path.resolve(abs);
    if (!a.startsWith(u)) throw new Error("Path must be under userDir");
    return a;
  }
  function expressJson(){
    return (req,res,next)=>{
      let data = ""; req.on("data",c=>data+=c);
      req.on("end",()=>{ try{ req.body=data?JSON.parse(data):{}; }catch{ req.body={}; } next(); });
    };
  }

  RED.httpAdmin.get("/data-validation-engine/config",
    RED.auth.needsPermission("nodes.read"),
    async (req,res)=>{
      try{
        const abs = ensureJsonUnderUserDir(RED, req.query.path);
        if (!fs.existsSync(abs)) return res.status(404).json({error:"not found"});
        const txt = await fsp.readFile(abs, "utf8");
        const json = JSON.parse(txt);
        const rules = Array.isArray(json) ? json : (Array.isArray(json.rules) ? json.rules : []);
        res.json({ rules });
      }catch(e){ res.status(400).json({ error:e.message }); }
    }
  );

  RED.httpAdmin.post("/data-validation-engine/config",
    RED.auth.needsPermission("nodes.write"),
    expressJson(),
    async (req,res)=>{
      try{
        const abs = ensureJsonUnderUserDir(RED, req.body?.path);
        const rules = Array.isArray(req.body?.rules) ? req.body.rules : [];
        await fsp.mkdir(path.dirname(abs), { recursive:true });
        await fsp.writeFile(abs, JSON.stringify(rules, null, 2), "utf8");
        res.json({ ok:true });
      }catch(e){ res.status(400).json({ error:e.message }); }
    }
  );
  // ===== end admin endpoints =====






  function coerceToString(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  }

  function isObject(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  // --- path helpers (dot notation, no array syntax) ---
  function getByPath(obj, dotPath) {
    if (!dotPath) return undefined;
    const parts = String(dotPath).split(".");
    let cur = obj;
    for (const k of parts) {
      if (!cur || typeof cur !== "object") return undefined;
      cur = cur[k];
    }
    return cur;
  }

  function hasPath(obj, dotPath) {
    return getByPath(obj, dotPath) !== undefined;
  }

  // --- tiny operator set ---
  function applyOp(actual, op, rhs) {
    const A = coerceToString(actual);
    const B = coerceToString(rhs);

    switch (op) {
      case "==": return A === B;
      case "!=": return A !== B;
      case "contains": return A.includes(B);
      case "!contains": return !A.includes(B);
      case "regex":
        try { return new RegExp(B).test(A); } catch { return false; }
      case "isEmpty": return A.trim() === "";
      case "!isEmpty": return A.trim() !== "";
      default: return true; // unknown op => do not block
    }
  }

  // resolve a typed RHS (str/num/bool/msg/flow/global/env/jsonata)
  function resolveTyped(RED, node, msg, flow, global, type, value) {
    switch (type) {
      case "num": return Number(value);
      case "bool": return !!value;
      case "env": return process.env[String(value)] || "";
      case "msg": return RED.util.getMessageProperty(msg, String(value));
      case "flow": return flow.get(String(value));
      case "global": return global.get(String(value));
      case "jsonata": {
        try {
          const expr = RED.util.prepareJSONataExpression(String(value), node);
          return RED.util.evaluateJSONataExpression(expr, msg);
        } catch { return undefined; }
      }
      case "str":
      default:
        return value;
    }
  }

  function evaluateRuleCondition(RED, node, rule, rootData, msg) {
    const cond = rule.conditions && rule.conditions.and && rule.conditions.and[0];
    if (!cond) return true;

    const actual = getByPath(rootData, cond.attribute || "");
    const rhs = resolveTyped(
      RED,
      node,
      msg,
      node.context().flow,
      node.context().global,
      cond.rhsType || "str",
      cond.value
    );
    return applyOp(actual, cond.operator || "==", rhs);
  }

  // --- log helpers ---
  function makeLog(rule, level, message) {
    const lvl = (rule.level || level || "info").toLowerCase();
    return {
      id: rule.id || "",
      type: rule.type,
      level: lvl,
      message: message,
      description: rule.description || ""
    };
  }

  function summarize(logs) {
    const out = { info: 0, warning: 0, error: 0, total: 0 };
    for (const l of logs) {
      if (l.level === "error") out.error++;
      else if (l.level === "warning") out.warning++;
      else out.info++;
    }
    out.total = out.info + out.warning + out.error;
    return out;
  }

  // --- rule executors ---
  function doSheetsExist(rule, data) {
    const logs = [];
    const req = Array.isArray(rule.requiredSheets) ? rule.requiredSheets : [];
    for (const s of req) {
      const sheet = data?.[s];
      const exists =
        sheet !== undefined &&
        (
          (Array.isArray(sheet) && sheet.length > 0) ||
          (isObject(sheet) && Object.keys(sheet).length > 0)
        );
      logs.push(makeLog(
        rule,
        exists ? "info" : (rule.level || "error"),
        exists
          ? `Sheet '${s}' exists and is not empty.`
          : `Sheet '${s}' is missing or empty.`
      ));
    }
    return logs;
  }

  function doSheetHasColumns(rule, data) {
    const logs = [];
    const sheetName = rule.sheet || "";
    const cols = Array.isArray(rule.requiredColumns) ? rule.requiredColumns : [];
    const sheet = data?.[sheetName];

    if (sheet === undefined) {
      logs.push(makeLog(rule, rule.level || "error", `Sheet '${sheetName}' not found.`));
      return logs;
    }

    // we only inspect the "shape": for array take first object; for object use it
    const sample = Array.isArray(sheet) ? sheet[0] : sheet;
    if (!isObject(sample)) {
      logs.push(makeLog(rule, rule.level || "error",
        `Sheet '${sheetName}' has no object rows to inspect.`));
      return logs;
    }

    for (const col of cols) {
      const ok = hasPath(sample, col);
      logs.push(makeLog(
        rule,
        ok ? "info" : (rule.level || "error"),
        ok
          ? `Column '${col}' found in '${sheetName}'.`
          : `Missing column '${col}' in '${sheetName}'.`
      ));
    }
    return logs;
  }

  // --- config file loader ---
  function resolveUserFile(RED, relOrAbs) {
    if (!relOrAbs) return null;
    if (path.isAbsolute(relOrAbs)) return relOrAbs;
    return path.join(RED.settings.userDir || process.cwd(), relOrAbs);
  }

  function loadRulesFromFile(filePath) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const txt = fs.readFileSync(filePath, "utf8");
      const json = JSON.parse(txt);
      return Array.isArray(json) ? json : (json && Array.isArray(json.rules) ? json.rules : null);
    } catch {
      return null;
    }
  }

  function DataValidationEngine(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.name = config.name || "";

    // editor props
    node.useConfigFile = !!config.useConfigFile;
    node.configPath = config.configPath || "";
    node.lockToFile = !!config.lockToFile;
    node.watchFile = !!config.watchFile;

    node.sourceScope = config.sourceScope || "msg";
    node.sourcePath = config.sourcePath || "data";

    node.defaultLevel = config.defaultLevel || "info";
    node.rules = Array.isArray(config.rules) ? config.rules : [];

    node._watched = null;
    node._fileRules = null;

    // load file rules on start (if enabled)
    const fileAbs = resolveUserFile(RED, node.configPath);
    if (node.useConfigFile && fileAbs && fileAbs.endsWith(RULES_FILE_SUFFIX)) {
      node._fileRules = loadRulesFromFile(fileAbs);
      if (node.watchFile) {
        try {
          node._watched = fs.watch(fileAbs, { persistent: false }, () => {
            node._fileRules = loadRulesFromFile(fileAbs);
            node.status({ fill: "blue", shape: "dot", text: "rules reloaded" });
            setTimeout(() => node.status({}), 1500);
          });
        } catch (e) {
          node.warn(`watch failed: ${e.message}`);
        }
      }
    }

    node.on("input", async function (msg, send, done) {
      try {
        // pick source root
        let root;
        try {
          if (node.sourceScope === "flow") {
            root = node.context().flow.get(node.sourcePath);
          } else if (node.sourceScope === "global") {
            root = node.context().global.get(node.sourcePath);
          } else {
            root = RED.util.getMessageProperty(msg, node.sourcePath);
          }
        } catch {
          root = undefined;
        }

        if (!isObject(root)) {
          node.status({ fill: "red", shape: "ring", text: "invalid input root" });
          send({ ...msg, validation: { logs: [], counts: { info: 0, warning: 0, error: 0, total: 0 } } });
          return done && done();
        }

        // pick rules: file > editor (when useConfigFile)
        const rules = node.useConfigFile && node._fileRules ? node._fileRules : node.rules;

        const logs = [];
        for (const rule of (rules || [])) {
          // default level fallback
          if (!rule.level) rule.level = node.defaultLevel;

          // rule-level condition (against root)
          if (!evaluateRuleCondition(RED, node, rule, root, msg)) continue;

          if (rule.type === "sheetsExist") {
            logs.push(...doSheetsExist(rule, root));
          } else if (rule.type === "sheetHasColumns") {
            logs.push(...doSheetHasColumns(rule, root));
          } else {
            // ignore unknown types in this simplified build
          }
        }

        const counts = summarize(logs);
        const worst = counts.error ? "error" : counts.warning ? "warning" : "info";
        node.status({ fill: worst === "error" ? "red" : worst === "warning" ? "yellow" : "green", shape: "dot",
          text: `E:${counts.error} W:${counts.warning} I:${counts.info}` });

        msg.validation = { logs, counts };
        send(msg);
        done && done();
      } catch (err) {
        node.status({ fill: "red", shape: "ring", text: "runtime error" });
        done ? done(err) : node.error(err);
      }
    });

    node.on("close", function () {
      try { if (node._watched) node._watched.close(); } catch {}
    });
  }



  RED.nodes.registerType("data-validation-engine", DataValidationEngine);
};
