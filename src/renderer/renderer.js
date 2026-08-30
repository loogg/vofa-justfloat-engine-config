(() => {
  "use strict";

  const api = window.engineApi || window.justFloatBuilder || null;
  const MAX_WORDS = 256;
  const CONFIG_VERSION = 2;
  const ENV_STORAGE_KEY = "justfloat-engine-builder.environment.v2";
  const REQUESTED_KIT = "Desktop_Qt_5_14_2_MSVC2017_64bit-Release";
  const LANGUAGES = Object.freeze({
    SimplifiedChinese: "简体中文",
    TraditionalChinese: "繁體中文",
    English: "English"
  });

  const TYPE_META = Object.freeze({
    bit: {
      label: "bit",
      width: 1,
      offsets: Array.from({ length: 32 }, (_, index) => index),
      hint: "可放置在 Bit 0–31 的任意位置",
      conversion: "0 / 1 → float"
    },
    uint8: {
      label: "uint8",
      width: 8,
      offsets: [0, 8, 16, 24],
      hint: "按 Byte 边界放置，共 4 个可选位置",
      conversion: "8-bit 无符号整数 → float"
    },
    uint16: {
      label: "uint16",
      width: 16,
      offsets: [0, 8, 16],
      hint: "按 Byte 边界放置，可从 Byte 0、1 或 2 开始",
      conversion: "16-bit 无符号整数 → float"
    },
    uint32: {
      label: "uint32",
      width: 32,
      offsets: [0],
      hint: "占满当前 4 字节数据单元",
      conversion: "32-bit 无符号整数 → float（注意精度）"
    },
    float: {
      label: "float",
      width: 32,
      offsets: [0],
      hint: "按 IEEE-754 单精度读取整个数据单元",
      conversion: "IEEE-754 float 原值"
    }
  });

  // Fluent-inspired, low-saturation colors keep adjacent packed channels distinct
  // without turning the engineering view into a rainbow dashboard. Assignment is
  // based on the physical output index, so changing the table's view sort never
  // changes a channel's color.
  const CHANNEL_PALETTE = Object.freeze([
    Object.freeze({ fill: "#e5f1fb", border: "#0f6cbd", text: "#0f548c" }),
    Object.freeze({ fill: "#e2f5f3", border: "#008272", text: "#006b60" }),
    Object.freeze({ fill: "#edf5e7", border: "#4f8a10", text: "#3d6f0c" }),
    Object.freeze({ fill: "#fff4ce", border: "#c19c00", text: "#735f00" }),
    Object.freeze({ fill: "#fce9d5", border: "#da6b16", text: "#8a3f00" }),
    Object.freeze({ fill: "#fde7e9", border: "#c50f1f", text: "#a20c18" }),
    Object.freeze({ fill: "#fce7f2", border: "#c23983", text: "#8f285f" }),
    Object.freeze({ fill: "#f0e7fe", border: "#744da9", text: "#5c2e91" }),
    Object.freeze({ fill: "#e8e9ff", border: "#4f55aa", text: "#3a3f86" }),
    Object.freeze({ fill: "#e0f6fc", border: "#0078a8", text: "#005b83" }),
    Object.freeze({ fill: "#f1f4d7", border: "#7a8500", text: "#596300" }),
    Object.freeze({ fill: "#f4ebe5", border: "#8e562e", text: "#6b3f22" })
  ]);

  const BUILTIN_TARGETS = new Set(["firewater", "indexfloat", "justfloat", "rawdata"]);
  const BUILTIN_CLASSES = new Set(["FireWater", "IndexFloat", "JustFloat", "RawData"]);
  const COLLIDING_CLASS_NAMES = new Set(["QObject", "DataEngineInterface", "RawImage", "Frame"]);
  const CPP_KEYWORDS = new Set([
    "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor", "bool", "break",
    "case", "catch", "char", "char16_t", "char32_t", "class", "compl", "concept", "const",
    "constexpr", "const_cast", "continue", "co_await", "co_return", "co_yield", "decltype", "default",
    "delete", "do", "double", "dynamic_cast", "else", "enum", "explicit", "export", "extern", "false",
    "float", "for", "friend", "goto", "if", "inline", "int", "long", "mutable", "namespace", "new",
    "noexcept", "not", "not_eq", "nullptr", "operator", "or", "or_eq", "private", "protected", "public",
    "register", "reinterpret_cast", "requires", "return", "short", "signed", "sizeof", "static",
    "static_assert", "static_cast", "struct", "switch", "template", "this", "thread_local", "throw", "true",
    "try", "typedef", "typeid", "typename", "union", "unsigned", "using", "virtual", "void", "volatile",
    "wchar_t", "while", "xor", "xor_eq", "emit", "foreach", "forever", "signals", "slots", "Q_OBJECT",
    "Q_GADGET", "Q_PROPERTY"
  ]);

  const ids = [
    "workspace", "unsaved-indicator", "load-config", "save-config", "repo-root-preview", "browse-repo",
    "dataengines-preview", "open-environment", "environment-status-icon", "environment-summary",
    "engine-name", "word-count", "word-count-minus", "word-count-plus", "frame-byte-count",
    "derived-target", "derived-class", "derived-dll", "derived-json", "engine-error", "stat-words",
    "stat-fields", "stat-used", "layout-stat-words", "layout-stat-fields", "description-tabs", "description-language-name", "description-format",
    "description-example", "description-url", "word-list", "word-list-count", "selected-word-label",
    "bit-grid", "editor-mode", "editor-word", "field-name", "field-type", "field-offset", "offset-hint",
    "allocation-range", "allocation-size", "field-error", "commit-field", "delete-field", "reset-editor",
    "field-editor", "fill-floats", "clear-word", "channel-sort", "channel-count", "channel-table-body",
    "empty-table", "source-path", "generated-path", "kit-badge", "open-generated-inline", "log-output",
    "log-state", "clear-log", "dock-icon", "dock-title", "dock-detail", "open-generated",
    "generate-only", "generate-build", "environment-dialog", "environment-form", "environment-overview",
    "environment-state-heading", "environment-state-detail", "environment-check-list", "environment-messages",
    "refresh-environment", "save-environment", "env-repo-root", "env-data-engines", "env-qmake", "env-jom",
    "env-vcvars", "env-kit-name", "build-environment-status-icon", "build-environment-title",
    "build-environment-detail", "open-environment-build", "toast-region"
  ];

  const dom = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  let uiIdSeed = 0;
  let logHasRealEntries = false;

  const state = {
    config: createDefaultConfig(),
    environment: normalizeEnvironment({}),
    activePage: "project",
    selectedWord: 0,
    editingId: null,
    activeLanguage: "SimplifiedChinese",
    channelSort: "physical",
    configPath: "",
    dirty: false,
    busy: false,
    busyAction: "",
    environmentLoaded: false,
    environmentScanning: false
  };

  function nextUiId() {
    uiIdSeed += 1;
    return `field-${Date.now().toString(36)}-${uiIdSeed}`;
  }

  function defaultDescriptions() {
    const url = "https://www.vofa.plus/docs/learning/dataengines/introduce";
    return {
      SimplifiedChinese: {
        format: "固定长度小端数据帧。每个数据单元占 4 字节，字段按配置的位置解析；帧末尾为 00 00 80 7F。",
        example: "按配置写入各字段后，追加帧尾：\nuint8_t tail[4] = {0x00, 0x00, 0x80, 0x7F};\nwrite((char *)tail, 4);",
        url
      },
      TraditionalChinese: {
        format: "固定長度小端資料幀。每個資料單元佔 4 位元組，欄位按配置的位置解析；幀末尾為 00 00 80 7F。",
        example: "按配置寫入各欄位後，追加幀尾：\nuint8_t tail[4] = {0x00, 0x00, 0x80, 0x7F};\nwrite((char *)tail, 4);",
        url
      },
      English: {
        format: "Fixed-length little-endian frames. Each data word occupies 4 bytes; fields are decoded at their configured positions. Append 00 00 80 7F as the frame tail.",
        example: "Write the configured fields, then append the frame tail:\nuint8_t tail[4] = {0x00, 0x00, 0x80, 0x7F};\nwrite((char *)tail, 4);",
        url
      }
    };
  }

  function createDefaultConfig() {
    return {
      version: CONFIG_VERSION,
      engineName: "Packed Float",
      wordCount: 4,
      fields: Array.from({ length: 4 }, (_, index) => ({
        _uiId: nextUiId(),
        wordIndex: index,
        type: "float",
        bitOffset: 0,
        name: `ch${index}`
      })),
      descriptions: defaultDescriptions()
    };
  }

  function stringValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function rawString(value) {
    return typeof value === "string" ? value : "";
  }

  function joinPath(base, child) {
    if (!base) return child;
    const separator = base.includes("\\") ? "\\" : "/";
    return `${base.replace(/[\\/]+$/, "")}${separator}${child}`;
  }

  function samePath(left, right) {
    const normalize = (value) => stringValue(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    return normalize(left) === normalize(right);
  }

  function deriveEngineNames(engineName) {
    const words = typeof engineName === "string"
      ? engineName
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
      : [];
    const targetName = words.join("").toLowerCase();
    const className = words.map((word) => (
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )).join("");
    return {
      className,
      targetName,
      dllName: targetName ? `${targetName}.dll` : "—",
      jsonName: targetName ? `${targetName}.json` : "—"
    };
  }

  function migrateV1EngineName(config) {
    const legacyTarget = stringValue(config.targetName);
    const legacyClass = stringValue(config.className);
    const candidates = [config.displayName, config.className, config.targetName]
      .map(stringValue)
      .filter((value, index, values) => value && values.indexOf(value) === index);
    return candidates.find((candidate) => {
      const derived = deriveEngineNames(candidate);
      return derived.targetName === legacyTarget && derived.className === legacyClass;
    }) || candidates.find((candidate) => deriveEngineNames(candidate).className === legacyClass)
      || candidates.find((candidate) => deriveEngineNames(candidate).targetName === legacyTarget)
      || candidates[0]
      || "";
  }

  function typeWidth(type) {
    return TYPE_META[type] ? TYPE_META[type].width : 0;
  }

  function sortedFields(fields = state.config.fields) {
    return [...fields].sort((left, right) =>
      left.wordIndex - right.wordIndex ||
      left.bitOffset - right.bitOffset ||
      left.name.localeCompare(right.name)
    );
  }

  function physicalChannelIndexMap() {
    return new Map(sortedFields().map((field, index) => [field._uiId, index]));
  }

  function channelPaletteAt(channelIndex) {
    return CHANNEL_PALETTE[channelIndex % CHANNEL_PALETTE.length];
  }

  function applyChannelPresentation(element, fieldId, channelIndex) {
    const color = channelPaletteAt(channelIndex);
    element.dataset.fieldId = fieldId;
    element.dataset.channelIndex = String(channelIndex);
    element.style.setProperty("--channel-fill", color.fill);
    element.style.setProperty("--channel-border", color.border);
    element.style.setProperty("--channel-text", color.text);
  }

  function viewedFields() {
    const physical = sortedFields();
    if (state.channelSort === "name") {
      return [...physical].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    }
    if (state.channelSort === "type") {
      return [...physical].sort((left, right) => left.type.localeCompare(right.type) || left.wordIndex - right.wordIndex || left.bitOffset - right.bitOffset);
    }
    return physical;
  }

  function normalizeDescriptions(value) {
    const defaults = defaultDescriptions();
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.keys(LANGUAGES).map((language) => {
      const entry = source[language] && typeof source[language] === "object" && !Array.isArray(source[language])
        ? source[language]
        : {};
      return [language, {
        format: typeof entry.format === "string" ? entry.format : defaults[language].format,
        example: typeof entry.example === "string" ? entry.example : defaults[language].example,
        url: typeof entry.url === "string" ? entry.url : defaults[language].url
      }];
    }));
  }

  function publicConfig() {
    return {
      version: CONFIG_VERSION,
      engineName: state.config.engineName.trim(),
      wordCount: state.config.wordCount,
      fields: sortedFields().map(({ wordIndex, type, bitOffset, name }) => ({
        wordIndex,
        type,
        bitOffset,
        name: name.trim()
      })),
      descriptions: Object.fromEntries(Object.keys(LANGUAGES).map((language) => [language, {
        format: rawString(state.config.descriptions[language]?.format),
        example: rawString(state.config.descriptions[language]?.example),
        url: rawString(state.config.descriptions[language]?.url)
      }]))
    };
  }

  function normalizeEnvironment(value = {}) {
    const source = value && typeof value === "object" && value.environment && typeof value.environment === "object"
      ? { ...value, ...value.environment }
      : value || {};
    const environment = {
      repoRoot: stringValue(source.repoRoot),
      dataEnginesDir: stringValue(source.dataEnginesDir),
      qmakePath: stringValue(source.qmakePath),
      jomPath: stringValue(source.jomPath),
      vcVarsPath: stringValue(source.vcVarsPath),
      kitName: stringValue(source.kitName) || REQUESTED_KIT,
      checks: source.checks || source.scan || source.statuses || null,
      missing: Array.isArray(source.missing) ? source.missing.map(String) : [],
      warnings: Array.isArray(source.warnings) ? source.warnings.map(String) : [],
      repositoryValid: source.repositoryValid === undefined ? source.repositoryReady : source.repositoryValid,
      repositoryReady: source.repositoryReady === undefined ? source.repositoryValid : source.repositoryReady,
      buildReady: source.buildReady,
      ready: source.ready,
      platform: stringValue(source.platform),
      cmdPath: stringValue(source.cmdPath),
      isRequestedQtKit: source.isRequestedQtKit,
      hasV141Toolset: source.hasV141Toolset,
      manualOverrides: Array.isArray(source.manualOverrides) ? source.manualOverrides.map(String) : [],
      error: stringValue(source.error)
    };
    if (!environment.dataEnginesDir && environment.repoRoot) {
      environment.dataEnginesDir = joinPath(environment.repoRoot, "dataengines");
    }
    return environment;
  }

  function publicEnvironmentFrom(value) {
    const environment = normalizeEnvironment(value);
    return {
      repoRoot: environment.repoRoot,
      dataEnginesDir: environment.dataEnginesDir,
      qmakePath: environment.qmakePath,
      jomPath: environment.jomPath,
      vcVarsPath: environment.vcVarsPath,
      kitName: environment.kitName
    };
  }

  function publicEnvironment() {
    return publicEnvironmentFrom(state.environment);
  }

  function environmentReadiness(environmentValue = state.environment) {
    const environment = normalizeEnvironment(environmentValue);
    const generationMissing = [];
    const buildMissing = [];
    if (!environment.repoRoot) generationMissing.push("仓库根目录");
    if (!environment.dataEnginesDir) generationMissing.push("Data Engines 目录");
    if (environment.repositoryValid === false) generationMissing.push("有效的 Vodka 仓库");
    if (!environment.qmakePath) buildMissing.push("qmake.exe");
    if (!environment.jomPath) buildMissing.push("jom.exe / nmake.exe");
    if (!environment.vcVarsPath) buildMissing.push("vcvarsall.bat");
    if (environment.qmakePath && environment.isRequestedQtKit === false) {
      buildMissing.push("Qt 5.14.2 MSVC2017 64-bit qmake.exe");
    }
    if (environment.vcVarsPath && environment.hasV141Toolset === false) {
      buildMissing.push("MSVC v141 x64 工具链");
    }
    if (environment.platform && environment.platform !== "win32") buildMissing.push("Windows 主机");
    if (environment.cmdPath === "" && environment.ready === false && environment.missing.some((item) => item.toLowerCase().includes("cmd.exe"))) {
      buildMissing.push("cmd.exe");
    }
    environment.missing.forEach((item) => {
      const lower = item.toLowerCase();
      if (lower.includes("repository")) return;
      const known = lower.includes("qmake") || lower.includes("qt 5.14.2") || lower.includes("exact qt")
        ? "Qt 5.14.2 MSVC2017 64-bit qmake.exe"
        : lower.includes("jom") || lower.includes("nmake")
          ? "jom.exe / nmake.exe"
          : lower.includes("visual studio") || lower.includes("msvc") || lower.includes("v141")
            ? "MSVC v141 x64 工具链"
            : lower.includes("windows")
              ? "Windows 主机"
              : lower.includes("cmd.exe")
                ? "cmd.exe"
                : item;
      buildMissing.push(known);
    });
    const uniqueGenerationMissing = [...new Set(generationMissing)];
    const uniqueBuildMissing = [...new Set([...uniqueGenerationMissing, ...buildMissing])];
    return {
      generationMissing: uniqueGenerationMissing,
      buildMissing: uniqueBuildMissing,
      generationReady: uniqueGenerationMissing.length === 0,
      buildReady: uniqueBuildMissing.length === 0,
      verificationPending: environment.manualOverrides.length > 0
    };
  }

  function rangeOverlaps(leftStart, leftWidth, rightStart, rightWidth) {
    return leftStart < rightStart + rightWidth && rightStart < leftStart + leftWidth;
  }

  function fieldAtBit(wordIndex, bit) {
    return state.config.fields.find((field) =>
      field.wordIndex === wordIndex && bit >= field.bitOffset && bit < field.bitOffset + typeWidth(field.type)
    );
  }

  function placementBlocked(wordIndex, bitOffset, type, ignoredId = null) {
    const width = typeWidth(type);
    return state.config.fields.some((field) =>
      field.wordIndex === wordIndex &&
      field._uiId !== ignoredId &&
      rangeOverlaps(bitOffset, width, field.bitOffset, typeWidth(field.type))
    );
  }

  function validateCandidate(config) {
    const errors = [];
    const derived = deriveEngineNames(config.engineName);
    if (config.version !== CONFIG_VERSION) errors.push(`仅支持 version: ${CONFIG_VERSION} 的配置。`);
    if (!config.engineName) {
      errors.push("请填写引擎名称。");
    } else if (!/^[A-Za-z][A-Za-z0-9 _-]*$/.test(config.engineName)) {
      errors.push("引擎名称需以英文字母开头，且只能包含英文字母、数字、空格、连字符或下划线。");
    }
    if (!derived.targetName || !/^[a-z][a-z0-9]*$/.test(derived.targetName)) {
      errors.push("无法从引擎名称派生有效的 Target 名称。");
    } else if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(derived.targetName)) {
      errors.push("派生的 Target 是 Windows 保留设备名，请更换引擎名称。");
    } else if (BUILTIN_TARGETS.has(derived.targetName)) {
      errors.push("引擎名称与内置数据引擎重名，请使用独立名称。");
    }
    if (!derived.className || CPP_KEYWORDS.has(derived.className) || COLLIDING_CLASS_NAMES.has(derived.className) || BUILTIN_CLASSES.has(derived.className)) {
      errors.push("派生的 C++ 类名无效或与已有类型冲突，请更换引擎名称。");
    }
    if (!Number.isInteger(config.wordCount) || config.wordCount < 1 || config.wordCount > MAX_WORDS) {
      errors.push(`4 字节数据单元数必须是 1–${MAX_WORDS} 的整数。`);
    }
    if (!Array.isArray(config.fields) || config.fields.length === 0) errors.push("至少需要配置一个输出字段。");

    const placements = new Map();
    (config.fields || []).forEach((field, index) => {
      const title = field.name || `字段 ${index + 1}`;
      const meta = TYPE_META[field.type];
      if (typeof field.name !== "string") errors.push(`${title} 的名称必须是字符串。`);
      if (!Number.isInteger(field.wordIndex) || field.wordIndex < 0 || field.wordIndex >= config.wordCount) {
        errors.push(`${title} 的 Word 位置越界。`);
      }
      if (!meta) {
        errors.push(`${title} 使用了未知字段类型。`);
        return;
      }
      if (!Number.isInteger(field.bitOffset) || !meta.offsets.includes(field.bitOffset) || field.bitOffset + meta.width > 32) {
        errors.push(`${title} 在 4 字节单元内的位置无效或越界。`);
      }
      const wordPlacements = placements.get(field.wordIndex) || [];
      if (wordPlacements.some((item) => rangeOverlaps(field.bitOffset, meta.width, item.bitOffset, item.width))) {
        errors.push(`${title} 与 Word ${field.wordIndex} 中的其他字段重叠。`);
      }
      wordPlacements.push({ bitOffset: field.bitOffset, width: meta.width });
      placements.set(field.wordIndex, wordPlacements);
    });

    Object.keys(LANGUAGES).forEach((language) => {
      const description = config.descriptions?.[language];
      if (!description || typeof description.format !== "string" || typeof description.example !== "string" || typeof description.url !== "string") {
        errors.push(`${LANGUAGES[language]} JSON 描述格式不完整。`);
      }
    });
    return [...new Set(errors)];
  }

  function validateCurrent() {
    return validateCandidate(publicConfig());
  }

  function normalizeConfig(raw) {
    const envelope = raw && typeof raw === "object" && raw.config ? raw.config : raw;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new Error("配置文件内容为空或格式不正确。");
    }
    const version = Number(envelope.version || 1);
    if (![1, 2].includes(version)) throw new Error(`不支持配置版本 ${version}。`);
    const config = {
      version: CONFIG_VERSION,
      engineName: version === 1 ? migrateV1EngineName(envelope) : stringValue(envelope.engineName),
      wordCount: Number(envelope.wordCount),
      fields: Array.isArray(envelope.fields) ? envelope.fields.map((field) => {
        if (!field || typeof field !== "object" || Array.isArray(field)) throw new Error("fields 中包含无效字段。");
        if (typeof field.name !== "string") throw new Error("字段 name 必须是字符串。");
        return {
          _uiId: nextUiId(),
          wordIndex: Number(field.wordIndex),
          type: stringValue(field.type),
          bitOffset: Number(field.bitOffset),
          name: field.name.trim()
        };
      }) : [],
      descriptions: normalizeDescriptions(envelope.descriptions)
    };
    const errors = validateCandidate({
      ...config,
      fields: config.fields.map(({ _uiId, ...field }) => field)
    });
    if (errors.length) throw new Error(`配置校验失败：${errors.slice(0, 3).join("；")}`);
    config.fields = sortedFields(config.fields);
    return config;
  }

  function syncBasicInputs() {
    dom["engine-name"].value = state.config.engineName;
    dom["word-count"].value = String(state.config.wordCount);
    renderDescriptionEditor();
  }

  function markDirty() {
    state.dirty = true;
    dom["unsaved-indicator"].hidden = false;
  }

  function markClean() {
    state.dirty = false;
    dom["unsaved-indicator"].hidden = true;
  }

  function render() {
    renderPage();
    renderDerivedNames();
    renderWordList();
    renderBitGrid();
    renderChannelTable();
    renderStats();
    renderEditorChrome();
    renderOffsetOptions();
    renderEnvironmentSummary();
    renderValidation();
  }

  function renderPage() {
    document.querySelectorAll("[data-page]").forEach((page) => {
      const active = page.dataset.page === state.activePage;
      page.hidden = !active;
      page.classList.toggle("is-active", active);
    });
    document.querySelectorAll("[data-page-target]").forEach((button) => {
      const active = button.dataset.pageTarget === state.activePage;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function selectPage(pageName, options = {}) {
    if (!document.querySelector(`[data-page="${pageName}"]`)) return;
    state.activePage = pageName;
    renderPage();
    dom.workspace?.scrollTo({ top: 0, behavior: options.instant ? "auto" : "smooth" });
    if (options.focusHeading) {
      const heading = document.querySelector(`[data-page="${pageName}"] h1`);
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }

  function renderDerivedNames() {
    const derived = deriveEngineNames(state.config.engineName);
    dom["derived-target"].textContent = derived.targetName || "—";
    dom["derived-class"].textContent = derived.className || "—";
    dom["derived-dll"].textContent = derived.dllName;
    dom["derived-json"].textContent = derived.jsonName;
    ["derived-target", "derived-class", "derived-dll", "derived-json"].forEach((key) => {
      dom[key].title = dom[key].textContent;
    });
  }

  function renderDescriptionEditor() {
    const language = state.activeLanguage;
    const description = state.config.descriptions[language];
    dom["description-language-name"].textContent = LANGUAGES[language];
    dom["description-format"].value = description.format;
    dom["description-example"].value = description.example;
    dom["description-url"].value = description.url;
    dom["description-tabs"].querySelectorAll("[data-language]").forEach((button) => {
      const active = button.dataset.language === language;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  function renderWordList() {
    const list = dom["word-list"];
    list.replaceChildren();
    dom["word-list-count"].textContent = String(state.config.wordCount);
    const outputIndexById = physicalChannelIndexMap();
    const fieldsByWord = Array.from({ length: state.config.wordCount }, () => []);
    sortedFields().forEach((field) => fieldsByWord[field.wordIndex]?.push(field));
    for (let wordIndex = 0; wordIndex < state.config.wordCount; wordIndex += 1) {
      const fields = fieldsByWord[wordIndex];
      const usedBits = fields.reduce((sum, field) => sum + typeWidth(field.type), 0);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `word-item${wordIndex === state.selectedWord ? " is-selected" : ""}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(wordIndex === state.selectedWord));
      button.setAttribute("aria-label", `Word ${wordIndex}，${fields.length ? `${fields.length} 个字段` : "空白"}，已用 ${usedBits}/32 bits`);
      button.dataset.wordIndex = String(wordIndex);
      const top = document.createElement("span");
      top.className = "word-item-top";
      const title = document.createElement("span");
      title.className = "word-item-title";
      const titleLabel = document.createElement("span");
      titleLabel.className = "word-item-title-label";
      titleLabel.textContent = "Word ";
      const titleIndex = document.createElement("strong");
      titleIndex.className = "word-item-index";
      titleIndex.textContent = String(wordIndex);
      title.append(titleLabel, titleIndex);
      const stats = document.createElement("span");
      stats.className = "word-item-stats";
      stats.textContent = fields.length ? `${fields.length} 个字段` : "无字段";
      top.append(title, stats);
      const usage = document.createElement("span");
      usage.className = "word-item-usage";
      usage.textContent = fields.length ? `已用 ${usedBits}/32 bits` : "空白 · 已用 0/32 bits";
      const bar = document.createElement("span");
      bar.className = "word-item-bar";
      for (let bit = 0; bit < 32; bit += 1) {
        const field = fields.find((item) => bit >= item.bitOffset && bit < item.bitOffset + typeWidth(item.type));
        const segment = document.createElement("i");
        if (field) {
          segment.className = `type-${field.type}`;
          applyChannelPresentation(segment, field._uiId, outputIndexById.get(field._uiId));
        }
        bar.append(segment);
      }
      button.append(top, usage, bar);
      list.append(button);
    }
  }

  function renderBitGrid() {
    const grid = dom["bit-grid"];
    grid.replaceChildren();
    const outputIndexById = physicalChannelIndexMap();
    dom["selected-word-label"].textContent = `Word ${state.selectedWord}`;
    for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
      const row = document.createElement("div");
      row.className = "byte-row";
      const label = document.createElement("div");
      label.className = "byte-label";
      const labelName = document.createElement("strong");
      labelName.textContent = `BYTE ${byteIndex}`;
      const labelRange = document.createElement("span");
      labelRange.textContent = `bits ${byteIndex * 8}–${byteIndex * 8 + 7}`;
      label.append(labelName, labelRange);
      row.append(label);
      for (let localBit = 7; localBit >= 0; localBit -= 1) {
        const bit = byteIndex * 8 + localBit;
        const field = fieldAtBit(state.selectedWord, bit);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "bit-cell";
        cell.dataset.bit = String(bit);
        if (field) {
          cell.classList.add("is-filled", `type-${field.type}`);
          if (field._uiId === state.editingId) cell.classList.add("is-selected-field");
          const meta = TYPE_META[field.type];
          const channelIndex = outputIndexById.get(field._uiId);
          const fieldStart = field.bitOffset;
          const fieldEnd = field.bitOffset + meta.width - 1;
          const rowStart = byteIndex * 8;
          const rowEnd = rowStart + 7;
          const visibleStart = Math.max(fieldStart, rowStart);
          const visibleEnd = Math.min(fieldEnd, rowEnd);
          applyChannelPresentation(cell, field._uiId, channelIndex);
          if (byteIndex === Math.floor(fieldStart / 8)) cell.classList.add("region-top");
          if (byteIndex === Math.floor(fieldEnd / 8)) cell.classList.add("region-bottom");
          if (bit === visibleEnd) cell.classList.add("region-left");
          if (bit === visibleStart) cell.classList.add("region-right");
          // Repeat the ch label once per occupied byte row. This makes a 32-bit
          // field read as one four-byte region instead of one labelled byte.
          const labelBit = visibleStart + Math.floor((visibleEnd - visibleStart) / 2);
          if (bit === labelBit) {
            cell.classList.add("has-channel-label");
            const cellName = document.createElement("span");
            cellName.className = "cell-name";
            cellName.textContent = `ch${channelIndex}`;
            cell.append(cellName);
          }
          cell.title = `ch${channelIndex} · Word ${field.wordIndex} · ${field.name} · ${field.type} · ${formatStorageSize(meta.width)} · ${formatRange(field.bitOffset, meta.width)}`;
          cell.setAttribute("aria-label", `编辑 ch${channelIndex}，Word ${field.wordIndex}，${field.type}，${formatStorageSize(meta.width)}`);
        } else {
          cell.title = `空白 Bit ${bit}，点击选择位置`;
          cell.setAttribute("aria-label", `选择空白 Bit ${bit}`);
        }
        const bitNumber = document.createElement("span");
        bitNumber.className = "cell-bit";
        bitNumber.textContent = String(bit);
        cell.append(bitNumber);
        row.append(cell);
      }
      grid.append(row);
    }
  }

  function renderChannelTable() {
    const physical = sortedFields();
    const outputIndexById = physicalChannelIndexMap();
    const fields = viewedFields();
    const body = dom["channel-table-body"];
    body.replaceChildren();
    dom["channel-count"].textContent = String(physical.length);
    dom["empty-table"].hidden = fields.length !== 0;
    document.querySelector(".channel-table").hidden = fields.length === 0;
    fields.forEach((field) => {
      const meta = TYPE_META[field.type];
      const channelIndex = outputIndexById.get(field._uiId);
      const row = document.createElement("tr");
      applyChannelPresentation(row, field._uiId, channelIndex);
      if (field._uiId === state.editingId) row.classList.add("is-selected-field");
      row.tabIndex = 0;
      row.title = `ch${channelIndex} · Word ${field.wordIndex} · ${field.type} · ${formatStorageSize(meta.width)}`;
      const channel = document.createElement("td");
      channel.className = "channel-index";
      const channelBadge = document.createElement("span");
      channelBadge.className = "channel-index-badge";
      channelBadge.textContent = `ch${channelIndex}`;
      channel.append(channelBadge);
      const name = document.createElement("td");
      name.className = "channel-name";
      name.textContent = field.name;
      const word = document.createElement("td");
      word.className = "word-cell";
      const wordBadge = document.createElement("span");
      wordBadge.className = "word-badge";
      wordBadge.textContent = `Word ${field.wordIndex}`;
      word.append(wordBadge);
      const type = document.createElement("td");
      const typeChip = document.createElement("span");
      typeChip.className = `type-chip type-${field.type}`;
      typeChip.textContent = field.type;
      type.append(typeChip);
      const position = document.createElement("td");
      position.className = "channel-position";
      const byteRange = document.createElement("span");
      byteRange.className = "position-primary position-bytes";
      byteRange.textContent = formatByteRange(field.bitOffset, meta.width);
      const bitRange = document.createElement("span");
      bitRange.className = "position-secondary position-bits";
      bitRange.textContent = formatRange(field.bitOffset, meta.width);
      position.append(byteRange, bitRange);
      const conversion = document.createElement("td");
      conversion.textContent = meta.conversion;
      const action = document.createElement("td");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "row-edit";
      edit.textContent = "编辑";
      edit.dataset.fieldId = field._uiId;
      action.append(edit);
      row.append(channel, name, word, type, position, conversion, action);
      body.append(row);
    });
  }

  function linkedFieldId(node, container) {
    if (!(node instanceof Element)) return null;
    const fieldElement = node.closest("[data-field-id]");
    return fieldElement && container.contains(fieldElement) ? fieldElement.dataset.fieldId : null;
  }

  function setLinkedFieldHover(fieldId, active) {
    if (!fieldId) return;
    document.querySelectorAll("[data-field-id]").forEach((element) => {
      if (element.dataset.fieldId === fieldId) element.classList.toggle("is-linked-hover", active);
    });
  }

  function bindLinkedFieldHover(container) {
    container.addEventListener("pointerover", (event) => {
      const fieldId = linkedFieldId(event.target, container);
      if (!fieldId || linkedFieldId(event.relatedTarget, container) === fieldId) return;
      setLinkedFieldHover(fieldId, true);
    });
    container.addEventListener("pointerout", (event) => {
      const fieldId = linkedFieldId(event.target, container);
      if (!fieldId || linkedFieldId(event.relatedTarget, container) === fieldId) return;
      setLinkedFieldHover(fieldId, false);
    });
  }

  function renderStats() {
    const usedBits = state.config.fields.reduce((sum, field) => sum + typeWidth(field.type), 0);
    const totalBits = state.config.wordCount * 32;
    const utilization = totalBits ? Math.round((usedBits / totalBits) * 100) : 0;
    dom["stat-words"].textContent = String(state.config.wordCount);
    dom["stat-fields"].textContent = String(state.config.fields.length);
    dom["stat-used"].textContent = `${utilization}%`;
    dom["layout-stat-words"].textContent = String(state.config.wordCount);
    dom["layout-stat-fields"].textContent = String(state.config.fields.length);
    dom["frame-byte-count"].textContent = `${state.config.wordCount * 4} Bytes`;
  }

  function renderEditorChrome() {
    const editing = state.config.fields.find((field) => field._uiId === state.editingId);
    dom["editor-word"].textContent = `WORD ${state.selectedWord}`;
    dom["editor-mode"].textContent = editing ? "编辑字段" : "添加字段";
    const iconMarkup = '<span class="icon icon-add" aria-hidden="true"></span>';
    dom["commit-field"].innerHTML = `${iconMarkup}${editing ? "更新字段" : "添加字段"}`;
    dom["delete-field"].hidden = !editing;
  }

  function renderOffsetOptions(preferredValue) {
    const select = dom["field-offset"];
    const type = dom["field-type"].value;
    const meta = TYPE_META[type] || TYPE_META.bit;
    const previous = preferredValue !== undefined ? Number(preferredValue) : Number(select.value);
    select.replaceChildren();
    meta.offsets.forEach((offset) => {
      const option = document.createElement("option");
      option.value = String(offset);
      const blocked = placementBlocked(state.selectedWord, offset, type, state.editingId);
      option.disabled = blocked;
      option.textContent = `${formatPosition(type, offset)}${blocked ? " · 已占用" : ""}`;
      select.append(option);
    });
    const preferred = [...select.options].find((option) => Number(option.value) === previous && !option.disabled);
    const available = preferred || [...select.options].find((option) => !option.disabled);
    if (available) select.value = available.value;
    else select.selectedIndex = -1;
    select.disabled = !available;
    dom["commit-field"].disabled = !available || state.busy;
    dom["offset-hint"].textContent = available ? meta.hint : `当前 Word 没有可容纳 ${type} 的连续位置`;
    updateAllocationPreview();
  }

  function updateAllocationPreview() {
    const type = dom["field-type"].value;
    const meta = TYPE_META[type] || TYPE_META.bit;
    const offset = Number(dom["field-offset"].value);
    if (dom["field-offset"].selectedIndex < 0 || !Number.isInteger(offset)) {
      dom["allocation-range"].textContent = "当前 Word 无可用位置";
      dom["allocation-size"].textContent = formatStorageSize(meta.width);
      return;
    }
    dom["allocation-range"].textContent = formatStorageSize(meta.width);
    dom["allocation-size"].textContent = formatRange(offset, meta.width);
  }

  function formatPosition(type, offset) {
    if (type === "bit") return `Bit ${offset}`;
    if (type === "uint8") return `Byte ${offset / 8}`;
    if (type === "uint16") return `Byte ${offset / 8}–${offset / 8 + 1}`;
    return "Byte 0–3";
  }

  function formatRange(offset, width) {
    return width === 1 ? `Bit ${offset}` : `Bits ${offset}–${offset + width - 1}`;
  }

  function formatByteRange(offset, width) {
    const firstByte = Math.floor(offset / 8);
    const lastByte = Math.floor((offset + width - 1) / 8);
    return firstByte === lastByte ? `Byte ${firstByte}` : `Byte ${firstByte}–${lastByte}`;
  }

  function formatStorageSize(width) {
    if (width === 1) return "1 bit";
    const bytes = width / 8;
    return `${bytes} Byte${bytes === 1 ? "" : "s"}`;
  }

  function renderEnvironmentSummary() {
    const environment = normalizeEnvironment(state.environment);
    const readiness = environmentReadiness(environment);
    dom["repo-root-preview"].value = environment.repoRoot;
    dom["dataengines-preview"].value = environment.dataEnginesDir;
    const statusIcon = dom["environment-status-icon"];
    if (!state.environmentLoaded || state.environmentScanning) {
      statusIcon.className = "status-icon";
      statusIcon.innerHTML = '<span class="icon icon-refresh" aria-hidden="true"></span>';
      dom["environment-summary"].textContent = "正在自动扫描…";
    } else if (readiness.buildReady && !readiness.verificationPending) {
      statusIcon.className = "status-icon is-ready";
      statusIcon.innerHTML = '<span class="icon icon-check" aria-hidden="true"></span>';
      dom["environment-summary"].textContent = "已就绪 · Qt 5.14.2 / MSVC x64";
    } else if (readiness.buildReady) {
      statusIcon.className = "status-icon is-warning";
      statusIcon.innerHTML = '<span class="icon icon-warning" aria-hidden="true"></span>';
      dom["environment-summary"].textContent = "已指定工具路径 · 构建时校验";
    } else {
      statusIcon.className = "status-icon is-warning";
      statusIcon.innerHTML = '<span class="icon icon-warning" aria-hidden="true"></span>';
      dom["environment-summary"].textContent = `缺少 ${readiness.buildMissing.length} 项，点击查看`;
    }
    dom["build-environment-status-icon"].className = statusIcon.className;
    dom["build-environment-status-icon"].innerHTML = statusIcon.innerHTML;
    if (!state.environmentLoaded || state.environmentScanning) {
      dom["build-environment-title"].textContent = "正在自动扫描";
      dom["build-environment-detail"].textContent = "正在检查仓库、Qt、构建工具和 MSVC。";
    } else if (readiness.buildReady && !readiness.verificationPending) {
      dom["build-environment-title"].textContent = "Release 构建环境已就绪";
      dom["build-environment-detail"].textContent = `${environment.kitName || REQUESTED_KIT} · 自动扫描通过`;
    } else if (readiness.buildReady) {
      dom["build-environment-title"].textContent = "工具路径等待构建校验";
      dom["build-environment-detail"].textContent = "已手动指定路径，构建开始前会再次验证。";
    } else {
      dom["build-environment-title"].textContent = "Release 构建环境不完整";
      dom["build-environment-detail"].textContent = `缺少：${readiness.buildMissing.join("、")}`;
    }
    dom["kit-badge"].textContent = environment.kitName || REQUESTED_KIT;
    const derived = deriveEngineNames(state.config.engineName);
    const sourceRoot = environment.dataEnginesDir || "dataengines";
    const source = derived.targetName ? joinPath(sourceRoot, derived.targetName) : joinPath(sourceRoot, "<engine>");
    const generated = joinPath(sourceRoot, "generated");
    dom["source-path"].textContent = source;
    dom["source-path"].title = source;
    dom["generated-path"].textContent = generated;
    dom["generated-path"].title = generated;
  }

  function renderValidation() {
    const errors = validateCurrent();
    const readiness = environmentReadiness();
    const firstError = errors[0] || "";
    dom["engine-error"].hidden = !firstError;
    dom["engine-error"].textContent = firstError;
    dom["engine-name"].classList.toggle("is-invalid", Boolean(firstError && firstError.includes("引擎名称")));

    if (!state.busy) {
      let status = "ready";
      let title = "配置和构建环境已就绪";
      let detail = `${state.config.fields.length} 个通道 · ${state.config.wordCount} 个数据单元 · ${(state.config.wordCount + 1) * 4} Bytes/帧（含帧尾）`;
      let icon = "check";
      if (errors.length) {
        status = "error";
        title = "配置尚未通过检查";
        detail = firstError;
        icon = "warning";
      } else if (!readiness.generationReady) {
        status = "error";
        title = "请选择有效的仓库根目录";
        detail = `缺少：${readiness.generationMissing.join("、")}`;
        icon = "warning";
      } else if (!readiness.buildReady) {
        status = "warning";
        title = "可生成源码，Release 构建环境未就绪";
        detail = `缺少：${readiness.buildMissing.join("、")}`;
        icon = "warning";
      } else if (readiness.verificationPending) {
        status = "warning";
        title = "已指定构建工具路径";
        detail = "手动路径将在 Release 构建开始前校验。";
        icon = "warning";
      }
      dom["dock-icon"].className = `dock-icon is-${status}`;
      dom["dock-icon"].innerHTML = `<span class="icon icon-${icon}" aria-hidden="true"></span>`;
      dom["dock-title"].textContent = title;
      dom["dock-detail"].textContent = detail;
    }

    const configBlocked = state.busy || errors.length > 0 || !api;
    dom["generate-only"].disabled = configBlocked || !readiness.generationReady;
    dom["generate-build"].disabled = configBlocked || !readiness.buildReady;
    dom["generate-only"].title = !readiness.generationReady ? `缺少：${readiness.generationMissing.join("、")}` : "";
    dom["generate-build"].title = !readiness.buildReady ? `构建环境缺少：${readiness.buildMissing.join("、")}` : "";
    dom["load-config"].disabled = state.busy || !api;
    dom["save-config"].disabled = state.busy || !api;
    dom["fill-floats"].disabled = state.busy;
    dom["clear-word"].disabled = state.busy;
    dom["browse-repo"].disabled = state.busy || !api;
  }

  function resetEditor(options = {}) {
    state.editingId = null;
    dom["field-name"].value = nextFieldName();
    if (!options.preserveType) dom["field-type"].value = "bit";
    hideFieldError();
    renderEditorChrome();
    renderOffsetOptions(options.preferredOffset);
    renderBitGrid();
  }

  function nextFieldName() {
    const names = new Set(state.config.fields.map((field) => field.name));
    let index = 0;
    while (names.has(`ch${index}`)) index += 1;
    return `ch${index}`;
  }

  function editField(fieldId, shouldScroll = false) {
    const field = state.config.fields.find((item) => item._uiId === fieldId);
    if (!field) return;
    state.selectedWord = field.wordIndex;
    state.editingId = field._uiId;
    dom["field-name"].value = field.name;
    dom["field-type"].value = field.type;
    hideFieldError();
    renderWordList();
    renderBitGrid();
    renderEditorChrome();
    renderOffsetOptions(field.bitOffset);
    if (shouldScroll) {
      selectPage("layout", { instant: true });
      document.getElementById("layout-section").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function showFieldError(message) {
    dom["field-error"].textContent = message;
    dom["field-error"].hidden = false;
  }

  function hideFieldError() {
    dom["field-error"].hidden = true;
    dom["field-error"].textContent = "";
  }

  function commitField(event) {
    event.preventDefault();
    if (state.busy) return;
    const name = dom["field-name"].value.trim() || nextFieldName();
    const type = dom["field-type"].value;
    const bitOffset = Number(dom["field-offset"].value);
    const meta = TYPE_META[type];
    if (!meta || !meta.offsets.includes(bitOffset) || bitOffset + meta.width > 32) {
      showFieldError("所选位置无效或超出当前 4 字节单元。");
      return;
    }
    if (placementBlocked(state.selectedWord, bitOffset, type, state.editingId)) {
      showFieldError("该范围与已有字段重叠，请换一个空白位置。");
      return;
    }
    const editing = state.config.fields.find((field) => field._uiId === state.editingId);
    if (editing) {
      Object.assign(editing, { name, type, bitOffset, wordIndex: state.selectedWord });
      appendLog(`已更新 ${name}：Word ${state.selectedWord} / ${formatRange(bitOffset, meta.width)} / ${type}`, "info");
    } else {
      state.config.fields.push({ _uiId: nextUiId(), name, type, bitOffset, wordIndex: state.selectedWord });
      appendLog(`已添加 ${name}：Word ${state.selectedWord} / ${formatRange(bitOffset, meta.width)} / ${type}`, "info");
    }
    state.config.fields = sortedFields();
    markDirty();
    resetEditor({ preserveType: true });
    render();
  }

  function deleteEditingField() {
    const editing = state.config.fields.find((field) => field._uiId === state.editingId);
    if (!editing || state.busy) return;
    state.config.fields = state.config.fields.filter((field) => field._uiId !== editing._uiId);
    appendLog(`已删除字段 ${editing.name}。`, "warning");
    markDirty();
    resetEditor({ preserveType: true });
    render();
  }

  function selectWord(wordIndex) {
    if (!Number.isInteger(wordIndex) || wordIndex < 0 || wordIndex >= state.config.wordCount) return;
    state.selectedWord = wordIndex;
    resetEditor({ preserveType: true });
    render();
  }

  function setWordCount(value) {
    const next = Number(value);
    if (!Number.isInteger(next) || next < 1 || next > MAX_WORDS) {
      dom["word-count"].value = String(state.config.wordCount);
      showToast("数据单元数量无效", `请输入 1–${MAX_WORDS} 之间的整数。`, "error");
      return;
    }
    const highestUsed = state.config.fields.reduce((highest, field) => Math.max(highest, field.wordIndex), -1);
    if (next <= highestUsed) {
      dom["word-count"].value = String(state.config.wordCount);
      showToast("无法缩减数据单元", `Word ${highestUsed} 仍包含字段，请先清空超出范围的单元。`, "error");
      return;
    }
    if (next === state.config.wordCount) return;
    state.config.wordCount = next;
    dom["word-count"].value = String(next);
    if (state.selectedWord >= next) state.selectedWord = next - 1;
    markDirty();
    resetEditor({ preserveType: true });
    render();
  }

  function restoreFloatLayout() {
    if (state.busy) return;
    const alreadyFloat = state.config.fields.length === state.config.wordCount && state.config.fields.every((field) => field.type === "float" && field.bitOffset === 0);
    if (!alreadyFloat && !window.confirm("这会替换全部字段，并为每个 4 字节单元恢复一个 float 通道。继续吗？")) return;
    state.config.fields = Array.from({ length: state.config.wordCount }, (_, wordIndex) => ({
      _uiId: nextUiId(), wordIndex, type: "float", bitOffset: 0, name: `ch${wordIndex}`
    }));
    markDirty();
    resetEditor();
    appendLog("已恢复与 JustFloat 一致的全 Float 布局。", "warning");
    render();
  }

  function clearCurrentWord() {
    const fields = state.config.fields.filter((field) => field.wordIndex === state.selectedWord);
    if (!fields.length || state.busy) return;
    if (!window.confirm(`确认删除 Word ${state.selectedWord} 中的 ${fields.length} 个字段吗？`)) return;
    state.config.fields = state.config.fields.filter((field) => field.wordIndex !== state.selectedWord);
    markDirty();
    resetEditor();
    appendLog(`已清空 Word ${state.selectedWord}。`, "warning");
    render();
  }

  function chooseBit(bit) {
    const occupied = fieldAtBit(state.selectedWord, bit);
    if (occupied) {
      editField(occupied._uiId);
      return;
    }
    const type = dom["field-type"].value;
    const width = typeWidth(type);
    const offset = width === 1 ? bit : width === 8 ? Math.floor(bit / 8) * 8 : width === 16 ? Math.min(Math.floor(bit / 8) * 8, 16) : 0;
    const option = [...dom["field-offset"].options].find((item) => Number(item.value) === offset && !item.disabled);
    if (option) {
      dom["field-offset"].value = option.value;
      updateAllocationPreview();
      dom["field-name"].focus();
    } else {
      showFieldError(`以 Bit ${bit} 为起点的 ${type} 范围不可用。`);
    }
  }

  async function loadConfig() {
    if (!requireApi("openConfig")) return;
    if (state.dirty && !window.confirm("当前配置有未保存的更改。仍要载入另一份配置吗？")) return;
    try {
      const result = await api.openConfig();
      if (!result) return;
      state.config = normalizeConfig(result);
      state.configPath = stringValue(result.filePath);
      state.selectedWord = 0;
      state.activeLanguage = "SimplifiedChinese";
      state.activePage = "project";
      syncBasicInputs();
      resetEditor();
      markClean();
      appendLog(`已载入配置${state.configPath ? `：${state.configPath}` : ""}`, "success");
      showToast("配置已载入", `${state.config.fields.length} 个字段，${state.config.wordCount} 个数据单元。`);
      render();
    } catch (error) {
      handleError("载入配置失败", error);
    }
  }

  async function saveConfig() {
    if (!requireApi("saveConfig")) return;
    const errors = validateCurrent();
    if (errors.length) {
      showToast("暂时无法保存", errors[0], "error");
      return;
    }
    try {
      const result = await api.saveConfig(publicConfig());
      if (!result) return;
      state.configPath = (typeof result === "string" ? result.trim() : stringValue(result.filePath)) || state.configPath;
      markClean();
      appendLog(`配置已保存${state.configPath ? `：${state.configPath}` : ""}`, "success");
      showToast("配置已保存", state.configPath || "JSON 配置文件已写入。", "success");
    } catch (error) {
      handleError("保存配置失败", error);
    }
  }

  function validateEnvironment(action) {
    const readiness = environmentReadiness();
    const missing = action === "build" ? readiness.buildMissing : readiness.generationMissing;
    return missing.length ? `缺少：${missing.join("、")}` : "";
  }

  async function runGeneration(action) {
    const method = action === "build" ? "build" : "generate";
    if (!requireApi(method)) return;
    const errors = validateCurrent();
    if (errors.length) {
      showToast("配置检查未通过", errors[0], "error");
      selectPage("project", { instant: true });
      document.getElementById("engine-section").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const environmentError = validateEnvironment(action);
    if (environmentError) {
      showToast("构建环境未就绪", environmentError, "error");
      openEnvironmentDialog();
      return;
    }
    const derived = deriveEngineNames(state.config.engineName);
    const label = action === "build" ? "生成并 Release 构建" : "生成源码";
    selectPage("build", { instant: true });
    setBusy(true, action === "build" ? "正在执行 Release 构建" : "正在生成自定义引擎源码", action);
    appendLog(`${label}开始：${derived.targetName}`, "info");
    try {
      const result = await api[method](publicConfig(), publicEnvironment());
      const message = resultMessage(result, action === "build" ? "Release 构建完成。" : "自定义引擎源码生成完成。");
      appendLog(message, "success");
      if (result && typeof result === "object") {
        if (result.sourceDirectory) appendLog(`源码目录：${result.sourceDirectory}`, "info");
        if (result.descriptionFile) appendLog(`JSON 描述：${result.descriptionFile}`, "info");
        if (result.dllFile) appendLog(`Release DLL：${result.dllFile}`, "success");
        if (result.outputDir) appendLog(`输出目录：${result.outputDir}`, "info");
      }
      showToast(action === "build" ? "Release 构建成功" : "源码生成成功", message, "success");
      dom["log-state"].textContent = action === "build" ? "构建成功" : "生成成功";
    } catch (error) {
      handleError(action === "build" ? "Release 构建失败" : "源码生成失败", error);
      dom["log-state"].textContent = "操作失败";
    } finally {
      setBusy(false);
    }
  }

  async function openGenerated() {
    if (!requireApi("openGenerated")) return;
    try {
      await api.openGenerated(publicEnvironment());
    } catch (error) {
      handleError("无法打开 generated 目录", error);
    }
  }

  function resultMessage(result, fallback) {
    if (typeof result === "string" && result.trim()) return result.trim();
    if (result && typeof result === "object") return stringValue(result.message) || stringValue(result.summary) || fallback;
    return fallback;
  }

  function setBusy(busy, detail = "", action = "") {
    state.busy = busy;
    state.busyAction = busy ? action : "";
    document.body.classList.toggle("is-busy", busy);
    dom["generate-build"].classList.toggle("is-loading", busy && action === "build");
    if (busy) {
      dom["dock-icon"].className = "dock-icon";
      dom["dock-icon"].innerHTML = '<span class="icon icon-settings" aria-hidden="true"></span>';
      dom["dock-title"].textContent = "任务正在运行";
      dom["dock-detail"].textContent = detail;
      dom["log-state"].textContent = detail;
    }
    renderEditorChrome();
    renderValidation();
  }

  function requireApi(method) {
    if (api && typeof api[method] === "function") return true;
    showToast("Electron 接口不可用", `预加载接口 engineApi.${method}() 未就绪。`, "error");
    appendLog(`缺少预加载接口：engineApi.${method}()`, "error");
    return false;
  }

  function loadStoredEnvironment() {
    try {
      const value = JSON.parse(localStorage.getItem(ENV_STORAGE_KEY) || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(
        ["repoRoot", "qmakePath", "jomPath", "vcVarsPath"]
          .filter((key) => typeof value[key] === "string" && value[key].trim())
          .map((key) => [key, value[key].trim()])
      );
    } catch {
      return {};
    }
  }

  function saveStoredEnvironment(environment) {
    try {
      const normalized = publicEnvironmentFrom(environment);
      localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify({
        repoRoot: normalized.repoRoot,
        qmakePath: normalized.qmakePath,
        jomPath: normalized.jomPath,
        vcVarsPath: normalized.vcVarsPath
      }));
    } catch {
      // Local storage can be unavailable under hardened Electron settings.
    }
  }

  async function detectEnvironment(options = {}) {
    if (!requireApi("getEnvironment")) {
      state.environmentLoaded = true;
      state.environmentScanning = false;
      renderEnvironmentSummary();
      renderValidation();
      return;
    }
    const stored = options.ignoreStored ? {} : loadStoredEnvironment();
    let candidate = options.ignoreStored
      ? normalizeEnvironment({ repoRoot: stringValue(options.repoRoot) || stringValue(state.environment.repoRoot) })
      : normalizeEnvironment({ ...state.environment, ...stored });
    if (options.environment) candidate = normalizeEnvironment(options.environment);
    if (stringValue(options.repoRoot)) {
      candidate.repoRoot = stringValue(options.repoRoot);
      candidate.dataEnginesDir = joinPath(candidate.repoRoot, "dataengines");
    }
    const hasSelectedEnvironment = Boolean(candidate.repoRoot || candidate.qmakePath || candidate.jomPath || candidate.vcVarsPath);
    const requestValue = hasSelectedEnvironment ? publicEnvironmentFrom(candidate) : undefined;
    state.environmentScanning = true;
    renderEnvironmentSummary();
    if (dom["environment-dialog"].open) renderEnvironmentDialogStatus();
    try {
      state.environment = normalizeEnvironment(await api.getEnvironment(requestValue));
      state.environmentLoaded = true;
      saveStoredEnvironment(state.environment);
      appendLog("仓库与 Qt / MSVC 构建环境扫描完成。", "success");
    } catch (error) {
      state.environmentLoaded = true;
      state.environment = normalizeEnvironment({
        ...state.environment,
        ...stored,
        ...publicEnvironmentFrom(candidate),
        error: errorMessage(error)
      });
      appendLog(`自动扫描构建环境失败：${errorMessage(error)}`, "warning");
    } finally {
      state.environmentScanning = false;
      renderEnvironmentSummary();
      renderValidation();
      if (options.updateDialog || dom["environment-dialog"].open) {
        fillEnvironmentForm();
        renderEnvironmentDialogStatus();
      }
    }
  }

  function openEnvironmentDialog() {
    fillEnvironmentForm();
    renderEnvironmentDialogStatus();
    if (typeof dom["environment-dialog"].showModal === "function" && !dom["environment-dialog"].open) {
      dom["environment-dialog"].showModal();
    }
  }

  function fillEnvironmentForm() {
    const environment = normalizeEnvironment(state.environment);
    dom["env-repo-root"].value = environment.repoRoot;
    dom["env-data-engines"].value = environment.dataEnginesDir;
    dom["env-qmake"].value = environment.qmakePath;
    dom["env-jom"].value = environment.jomPath;
    dom["env-vcvars"].value = environment.vcVarsPath;
    dom["env-kit-name"].value = environment.kitName;
  }

  function readEnvironmentForm() {
    const manualOverrides = new Set(state.environment.manualOverrides || []);
    const formValues = {
      qmakePath: dom["env-qmake"].value,
      jomPath: dom["env-jom"].value,
      vcVarsPath: dom["env-vcvars"].value
    };
    Object.entries(formValues).forEach(([key, value]) => {
      if (!samePath(value, state.environment[key])) manualOverrides.add(key);
    });
    return normalizeEnvironment({
      ...state.environment,
      repoRoot: dom["env-repo-root"].value,
      dataEnginesDir: dom["env-data-engines"].value,
      ...formValues,
      kitName: dom["env-kit-name"].value,
      manualOverrides: [...manualOverrides]
    });
  }

  function normalizeCheckStatus(item, fallbackReady) {
    if (!item || typeof item !== "object") return fallbackReady ? "ready" : "missing";
    if (item.ok === true || item.found === true || item.valid === true || item.status === "ready" || item.status === "ok") return "ready";
    if (item.warning === true || item.status === "warning") return "warning";
    if (item.ok === false || item.found === false || item.valid === false || item.status === "missing" || item.status === "error") return "missing";
    return fallbackReady ? "ready" : "missing";
  }

  function checkFromSource(environment, key, aliases = []) {
    const checks = environment.checks;
    if (Array.isArray(checks)) {
      return checks.find((item) => {
        const identity = String(item?.key || item?.name || item?.id || "").toLowerCase();
        return [key, ...aliases].some((candidate) => identity === candidate.toLowerCase());
      }) || null;
    }
    if (checks && typeof checks === "object") {
      for (const candidate of [key, ...aliases]) {
        if (checks[candidate] !== undefined) return checks[candidate];
      }
    }
    return null;
  }

  function renderEnvironmentDialogStatus() {
    const environment = dom["environment-dialog"].open ? readEnvironmentForm() : normalizeEnvironment(state.environment);
    const readiness = environmentReadiness(environment);
    const overviewIcon = dom["environment-overview"].querySelector(".status-icon");
    if (state.environmentScanning) {
      overviewIcon.className = "status-icon";
      overviewIcon.innerHTML = '<span class="icon icon-refresh"></span>';
      dom["environment-state-heading"].textContent = "正在自动扫描构建环境";
      dom["environment-state-detail"].textContent = "正在查找仓库、Qt 5.14.2、构建工具和 MSVC。";
    } else if (readiness.buildReady && !readiness.verificationPending) {
      overviewIcon.className = "status-icon is-ready";
      overviewIcon.innerHTML = '<span class="icon icon-check"></span>';
      dom["environment-state-heading"].textContent = "Release 构建环境已就绪";
      dom["environment-state-detail"].textContent = REQUESTED_KIT;
    } else if (readiness.buildReady) {
      overviewIcon.className = "status-icon is-warning";
      overviewIcon.innerHTML = '<span class="icon icon-warning"></span>';
      dom["environment-state-heading"].textContent = "已指定工具路径，等待构建校验";
      dom["environment-state-detail"].textContent = "手动选择的路径会在 Release 构建开始前验证版本和工具链。";
    } else {
      overviewIcon.className = "status-icon is-warning";
      overviewIcon.innerHTML = '<span class="icon icon-warning"></span>';
      dom["environment-state-heading"].textContent = "构建环境不完整";
      dom["environment-state-detail"].textContent = `缺少 ${readiness.buildMissing.length} 项；补齐前 Release 构建按钮不可用。`;
    }

    const overrides = new Set(environment.manualOverrides);
    const definitions = [
      { key: "repoRoot", aliases: ["repository"], label: "Vodka 仓库", value: environment.repoRoot, ready: Boolean(environment.repoRoot) && environment.repositoryValid !== false },
      { key: "dataEnginesDir", aliases: ["dataengines"], label: "Data Engines", value: environment.dataEnginesDir, ready: Boolean(environment.dataEnginesDir) && environment.repositoryValid !== false },
      { key: "qmakePath", aliases: ["qmake"], label: "qmake.exe", value: environment.qmakePath, ready: Boolean(environment.qmakePath) && environment.isRequestedQtKit !== false },
      { key: "jomPath", aliases: ["jom", "nmake"], label: "jom / nmake", value: environment.jomPath, ready: Boolean(environment.jomPath) },
      { key: "vcVarsPath", aliases: ["vcvars", "msvc"], label: "MSVC 环境", value: environment.vcVarsPath, ready: Boolean(environment.vcVarsPath) && environment.hasV141Toolset !== false },
      { key: "kitName", aliases: ["kit"], label: "Release Kit", value: environment.kitName, ready: environment.isRequestedQtKit !== false }
    ];
    dom["environment-check-list"].replaceChildren();
    definitions.forEach((definition) => {
      const sourceCheck = checkFromSource(environment, definition.key, definition.aliases);
      const status = overrides.has(definition.key)
        ? "warning"
        : normalizeCheckStatus(sourceCheck, definition.ready);
      const detail = sourceCheck && typeof sourceCheck === "object"
        ? stringValue(sourceCheck.path) || stringValue(sourceCheck.message) || stringValue(sourceCheck.detail) || definition.value
        : definition.value;
      const item = document.createElement("li");
      item.className = `is-${status}`;
      const icon = document.createElement("span");
      icon.className = `icon icon-${status === "ready" ? "check" : "warning"}`;
      const label = document.createElement("strong");
      label.textContent = definition.label;
      const copy = document.createElement("span");
      copy.textContent = detail || "未找到";
      copy.title = copy.textContent;
      item.append(icon, label, copy);
      dom["environment-check-list"].append(item);
    });

    const messages = [...environment.missing.map((message) => `缺失：${message}`), ...environment.warnings.map((message) => `提示：${message}`)];
    if (environment.error) messages.push(`扫描失败：${environment.error}`);
    dom["environment-messages"].hidden = messages.length === 0;
    dom["environment-messages"].replaceChildren(...messages.map((message) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = message;
      return paragraph;
    }));
  }

  async function selectEnvironmentPath(kind, button, options = {}) {
    if (!requireApi("selectPath")) return;
    button.disabled = true;
    try {
      const selected = await api.selectPath(kind);
      if (!selected) return;
      const selectedPath = typeof selected === "string" ? selected : stringValue(selected.path);
      if (!selectedPath) return;
      if (kind === "repoRoot") {
        const candidate = normalizeEnvironment({ ...state.environment, repoRoot: selectedPath, dataEnginesDir: joinPath(selectedPath, "dataengines") });
        await detectEnvironment({ environment: candidate, ignoreStored: true, updateDialog: dom["environment-dialog"].open });
        if (options.openDialog) openEnvironmentDialog();
        return;
      }
      const inputByKind = { qmakePath: dom["env-qmake"], jomPath: dom["env-jom"], vcVarsPath: dom["env-vcvars"] };
      if (inputByKind[kind]) inputByKind[kind].value = selectedPath;
      await detectEnvironment({ environment: readEnvironmentForm(), ignoreStored: true, updateDialog: true });
    } catch (error) {
      handleError("选择路径失败", error);
    } finally {
      button.disabled = false;
    }
  }

  function appendLog(message, level = "info") {
    if (!message) return;
    if (!logHasRealEntries) {
      dom["log-output"].replaceChildren();
      logHasRealEntries = true;
    }
    const normalizedLevel = ["success", "error", "warning", "info"].includes(level) ? level : "info";
    String(message).replace(/\r/g, "").split("\n").filter(Boolean).forEach((lineText) => {
      const line = document.createElement("div");
      line.className = `log-line is-${normalizedLevel}`;
      const time = document.createElement("time");
      time.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
      const content = document.createElement("span");
      content.textContent = lineText;
      line.append(time, content);
      dom["log-output"].append(line);
    });
    while (dom["log-output"].children.length > 500) dom["log-output"].firstElementChild.remove();
    dom["log-output"].scrollTop = dom["log-output"].scrollHeight;
  }

  function receiveBuildLog(entry) {
    if (typeof entry === "string") {
      appendLog(entry, "info");
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const levelMap = { warn: "warning", stderr: "error", stdout: "info", done: "success" };
    appendLog(entry.message || entry.text || entry.line || JSON.stringify(entry), levelMap[entry.level] || entry.level || "info");
  }

  function showToast(title, message, level = "success") {
    const toast = document.createElement("div");
    toast.className = `toast${level === "error" ? " is-error" : ""}`;
    const iconWrap = document.createElement("span");
    iconWrap.className = "toast-icon";
    const icon = document.createElement("span");
    icon.className = `icon icon-${level === "error" ? "warning" : "check"}`;
    iconWrap.append(icon);
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = message;
    copy.append(heading, detail);
    toast.append(iconWrap, copy);
    dom["toast-region"].append(toast);
    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 140);
    }, 3600);
  }

  function errorMessage(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error.message === "string") return error.message;
    return "发生未知错误。";
  }

  function handleError(title, error) {
    const message = errorMessage(error);
    appendLog(`${title}：${message}`, "error");
    showToast(title, message, "error");
  }

  function bindEvents() {
    document.querySelectorAll("[data-page-target]").forEach((button) => {
      button.addEventListener("click", () => selectPage(button.dataset.pageTarget, { focusHeading: true }));
    });

    dom["engine-name"].addEventListener("input", (event) => {
      state.config.engineName = event.target.value;
      markDirty();
      renderDerivedNames();
      renderEnvironmentSummary();
      renderValidation();
    });
    dom["word-count"].addEventListener("change", (event) => setWordCount(event.target.value));
    dom["word-count-minus"].addEventListener("click", () => setWordCount(state.config.wordCount - 1));
    dom["word-count-plus"].addEventListener("click", () => setWordCount(state.config.wordCount + 1));

    dom["description-tabs"].addEventListener("click", (event) => {
      const tab = event.target.closest("[data-language]");
      if (!tab || !LANGUAGES[tab.dataset.language]) return;
      state.activeLanguage = tab.dataset.language;
      renderDescriptionEditor();
    });
    [["description-format", "format"], ["description-example", "example"], ["description-url", "url"]].forEach(([id, key]) => {
      dom[id].addEventListener("input", (event) => {
        state.config.descriptions[state.activeLanguage][key] = event.target.value;
        markDirty();
        renderValidation();
      });
    });

    dom["word-list"].addEventListener("click", (event) => {
      const button = event.target.closest("[data-word-index]");
      if (button) selectWord(Number(button.dataset.wordIndex));
    });
    dom["bit-grid"].addEventListener("click", (event) => {
      const cell = event.target.closest("[data-bit]");
      if (cell) chooseBit(Number(cell.dataset.bit));
    });
    dom["field-type"].addEventListener("change", () => {
      hideFieldError();
      renderOffsetOptions();
    });
    dom["field-offset"].addEventListener("change", updateAllocationPreview);
    dom["field-name"].addEventListener("input", hideFieldError);
    dom["field-editor"].addEventListener("submit", commitField);
    dom["delete-field"].addEventListener("click", deleteEditingField);
    dom["reset-editor"].addEventListener("click", () => resetEditor());
    dom["fill-floats"].addEventListener("click", restoreFloatLayout);
    dom["clear-word"].addEventListener("click", clearCurrentWord);
    dom["channel-sort"].addEventListener("change", (event) => {
      state.channelSort = event.target.value;
      renderChannelTable();
    });

    dom["channel-table-body"].addEventListener("click", (event) => {
      const target = event.target.closest("[data-field-id]");
      if (target) editField(target.dataset.fieldId, true);
    });
    dom["channel-table-body"].addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target.matches("tr[data-field-id]")) {
        event.preventDefault();
        editField(event.target.dataset.fieldId, true);
      }
    });
    bindLinkedFieldHover(dom["bit-grid"]);
    bindLinkedFieldHover(dom["channel-table-body"]);

    dom["load-config"].addEventListener("click", loadConfig);
    dom["save-config"].addEventListener("click", saveConfig);
    dom["generate-only"].addEventListener("click", () => runGeneration("generate"));
    dom["generate-build"].addEventListener("click", () => runGeneration("build"));
    dom["open-generated"].addEventListener("click", openGenerated);
    dom["open-generated-inline"].addEventListener("click", openGenerated);
    dom["clear-log"].addEventListener("click", () => {
      dom["log-output"].replaceChildren();
      logHasRealEntries = true;
      dom["log-state"].textContent = "日志已清空";
    });

    dom["browse-repo"].addEventListener("click", () => selectEnvironmentPath("repoRoot", dom["browse-repo"]));
    dom["open-environment"].addEventListener("click", openEnvironmentDialog);
    dom["open-environment-build"].addEventListener("click", openEnvironmentDialog);
    dom["env-repo-root"].addEventListener("input", (event) => {
      dom["env-data-engines"].value = event.target.value.trim() ? joinPath(event.target.value.trim(), "dataengines") : "";
      renderEnvironmentDialogStatus();
    });
    ["env-qmake", "env-jom", "env-vcvars"].forEach((id) => dom[id].addEventListener("input", renderEnvironmentDialogStatus));
    dom["environment-form"].addEventListener("submit", async (event) => {
      if (event.submitter && event.submitter.id === "save-environment") {
        event.preventDefault();
        state.environment = readEnvironmentForm();
        saveStoredEnvironment(state.environment);
        renderEnvironmentSummary();
        renderValidation();
        appendLog("本机构建环境设置已保存，正在校验所选路径。", "info");
        showToast("构建环境已保存", "正在校验仓库与工具链…", "success");
        await detectEnvironment({ environment: state.environment, ignoreStored: true, updateDialog: true });
        const readiness = environmentReadiness();
        if (readiness.buildReady) {
          showToast("Release 构建环境已就绪", REQUESTED_KIT, "success");
        } else {
          showToast("构建环境仍不完整", `缺少：${readiness.buildMissing.join("、")}`, "error");
        }
        dom["environment-dialog"].close("default");
      }
    });
    dom["refresh-environment"].addEventListener("click", () => detectEnvironment({
      environment: readEnvironmentForm(),
      ignoreStored: true,
      updateDialog: true
    }));
    document.querySelectorAll("[data-select-path]").forEach((button) => {
      button.addEventListener("click", () => selectEnvironmentPath(button.dataset.selectPath, button));
    });
  }

  function subscribeToLogs() {
    if (!api || typeof api.onBuildLog !== "function") return;
    try {
      api.onBuildLog(receiveBuildLog);
    } catch (error) {
      appendLog(`无法订阅构建日志：${errorMessage(error)}`, "warning");
    }
  }

  function initialize() {
    syncBasicInputs();
    bindEvents();
    subscribeToLogs();
    resetEditor();
    render();
    if (!api) {
      state.environmentLoaded = true;
      appendLog("未检测到 window.engineApi；可视化编辑可用，生成与构建功能已禁用。", "error");
      renderEnvironmentSummary();
      renderValidation();
      return;
    }
    detectEnvironment();
  }

  initialize();
})();
