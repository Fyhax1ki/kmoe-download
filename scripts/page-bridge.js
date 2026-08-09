(function() {
  const SOURCE = 'kmoe-download-page-bridge';
  const MESSAGE_PREFIX = 'KMOE_MANGA_DATA=';
  let lastPayloadKey = '';
  let moduleSourceKey = '';
  let moduleData = null;
  let observedVolData = [];

  function parseQuotedString(text, start) {
    const quote = text[start];
    let value = '';
    let i = start + 1;

    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        if (i + 1 < text.length) {
          value += text[i + 1];
          i += 2;
          continue;
        }
      }
      if (ch === quote) {
        return { value: value, end: i + 1 };
      }
      value += ch;
      i++;
    }

    return null;
  }

  function skipWhitespace(text, index) {
    while (index < text.length && /\s/.test(text[index])) index++;
    return index;
  }

  function parseArrayValue(text, index) {
    index = skipWhitespace(text, index);
    const ch = text[index];

    if (ch === '[') {
      const values = [];
      index++;

      while (index < text.length) {
        index = skipWhitespace(text, index);
        if (text[index] === ']') {
          return { value: values, end: index + 1 };
        }

        const item = parseArrayValue(text, index);
        if (!item) return null;
        values.push(item.value);
        index = skipWhitespace(text, item.end);

        if (text[index] === ',') {
          index++;
          continue;
        }
        if (text[index] === ']') {
          return { value: values, end: index + 1 };
        }
        return null;
      }

      return null;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      return parseQuotedString(text, index);
    }

    let end = index;
    while (end < text.length && text[end] !== ',' && text[end] !== ']') end++;
    const raw = text.slice(index, end).trim();
    if (raw === 'null') return { value: null, end: end };
    if (raw === 'undefined') return { value: undefined, end: end };
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) return { value: Number(raw), end: end };
    return { value: raw, end: end };
  }

  function parseArrayLiteral(text) {
    const start = text.indexOf('[');
    if (start < 0) return null;
    const parsed = parseArrayValue(text, start);
    return parsed && Array.isArray(parsed.value) ? parsed.value : null;
  }

  function splitByTopLevelPlus(expr) {
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = '';

    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (quote) {
        if (ch === '\\') {
          i++;
        } else if (ch === quote) {
          quote = '';
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      } else if (ch === '+' && depth === 0) {
        parts.push(expr.slice(start, i).trim());
        start = i + 1;
      }
    }

    parts.push(expr.slice(start).trim());
    return parts;
  }

  function parseExpression(expr, vars) {
    expr = (expr || '').trim();
    if (!expr) return undefined;

    const parseIntMatch = expr.match(/^parseInt\s*\(([\s\S]*)\)$/);
    if (parseIntMatch) {
      return parseInt(parseExpression(parseIntMatch[1], vars), 10);
    }

    const numberMatch = expr.match(/^Number\s*\(([\s\S]*)\)$/);
    if (numberMatch) {
      return Number(parseExpression(numberMatch[1], vars));
    }

    if (expr === 'new Array()') return [];
    if (expr[0] === '[') return parseArrayLiteral(expr);

    const plusParts = splitByTopLevelPlus(expr);
    if (plusParts.length > 1) {
      return plusParts.map(function(part) {
        const value = parseExpression(part, vars);
        return value === undefined || value === null ? '' : String(value);
      }).join('');
    }

    if (expr[0] === '"' || expr[0] === "'") {
      const parsed = parseQuotedString(expr, 0);
      return parsed ? parsed.value : undefined;
    }

    if (expr[0] === '`') {
      const parsed = parseQuotedString(expr, 0);
      if (!parsed) return undefined;
      return parsed.value.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, function(match, name) {
        return vars[name] === undefined || vars[name] === null ? '' : String(vars[name]);
      });
    }

    if (/^-?\d+(?:\.\d+)?$/.test(expr)) return Number(expr);
    if (Object.prototype.hasOwnProperty.call(vars, expr)) return vars[expr];
    return undefined;
  }

  function findDeclarationExpression(source, name) {
    const pattern = new RegExp('(?:var|let|const)\\s+' + name + '\\s*=\\s*', 'g');
    const match = pattern.exec(source);
    if (!match) return null;

    let i = match.index + match[0].length;
    let depth = 0;
    let quote = '';

    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') {
          i++;
        } else if (ch === quote) {
          quote = '';
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth--;
      } else if (ch === ';' && depth === 0) {
        return source.slice(match.index + match[0].length, i).trim();
      }
    }

    return null;
  }

  function findCallArguments(source, callName) {
    const args = [];
    let index = 0;

    while (index < source.length) {
      const start = source.indexOf(callName, index);
      if (start < 0) break;
      let i = start + callName.length;
      i = skipWhitespace(source, i);
      if (source[i] !== '(') {
        index = i;
        continue;
      }

      const argStart = i + 1;
      let depth = 1;
      let quote = '';
      i++;

      for (; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
          if (ch === '\\') {
            i++;
          } else if (ch === quote) {
            quote = '';
          }
          continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
          quote = ch;
        } else if (ch === '(' || ch === '[') {
          depth++;
        } else if (ch === ')' || ch === ']') {
          depth--;
          if (depth === 0) {
            args.push(source.slice(argStart, i).trim());
            i++;
            break;
          }
        }
      }

      index = i;
    }

    return args;
  }

  function parseModuleScripts() {
    const scripts = Array.from(document.querySelectorAll('script[type="module"]'));
    const source = scripts.map(function(script) {
      return script.textContent || '';
    }).join('\n');
    const key = source.length + ':' + source.slice(0, 200) + ':' + source.slice(-200);

    if (key === moduleSourceKey && moduleData) return moduleData;
    moduleSourceKey = key;

    const vars = {};
    [
      'bookid',
      'str_down_url_prefix',
      'str_down_url_pre',
      'str_down_url_subfix',
      'str_down_url_suffix',
      'down_domain',
      'str_down_domain',
      'str_down_host',
      'str_urldomain',
      'u_def_file',
      'quota_now',
      'quota_used'
    ].forEach(function(name) {
      const expr = findDeclarationExpression(source, name);
      if (expr !== null) {
        vars[name] = parseExpression(expr, vars);
      }
    });

    const parsed = {
      bookId: vars.bookid,
      arr: [],
      downPrefix: vars.str_down_url_prefix || vars.str_down_url_pre,
      downSuffix: vars.str_down_url_subfix || vars.str_down_url_suffix,
      downloadOrigin: vars.down_domain || vars.str_down_domain || vars.str_down_host || vars.str_urldomain,
      fileFormat: typeof vars.u_def_file !== 'undefined' ? Number(vars.u_def_file) : null,
      quotaAvailable: typeof vars.quota_now !== 'undefined' ? Number(vars.quota_now) : null,
      quotaUsed: typeof vars.quota_used !== 'undefined' ? Number(vars.quota_used) : null
    };

    const arrExpr = findDeclarationExpression(source, 'arr_voldata');
    const arrLiteral = arrExpr && arrExpr[0] === '[' ? parseArrayLiteral(arrExpr) : null;
    if (Array.isArray(arrLiteral)) {
      parsed.arr = arrLiteral;
    }

    findCallArguments(source, 'arr_voldata.push').forEach(function(arg) {
      const value = parseExpression(arg, vars);
      if (Array.isArray(value)) {
        parsed.arr.push(value);
      }
    });

    moduleData = parsed;
    return moduleData;
  }

  function getModuleData() {
    const parsed = parseModuleScripts();
    if (!parsed || !parsed.bookId) return null;

    return {
      bookId: parsed.bookId,
      arr: observedVolData.length ? observedVolData : parsed.arr,
      downPrefix: parsed.downPrefix,
      downSuffix: parsed.downSuffix,
      downloadOrigin: parsed.downloadOrigin,
      fileFormat: parsed.fileFormat,
      quotaAvailable: parsed.quotaAvailable,
      quotaUsed: parsed.quotaUsed
    };
  }

  function mapVolumeData(volData) {
    return volData.map(function(item) {
      return {
        id: item[0],
        category: item[3],
        name: item[5],
        mobiSize: item[9] ? parseFloat(item[9]) : null,
        epubSize: item[11] ? parseFloat(item[11]) : null
      };
    });
  }

  function getPageData() {
    if (Array.isArray(window.arr_voldata) && window.arr_voldata.length && window.bookid) {
      return {
        bookId: window.bookid,
        arr: window.arr_voldata,
        downPrefix: window.str_down_url_prefix || window.str_down_url_pre,
        downSuffix: window.str_down_url_subfix || window.str_down_url_suffix,
        downloadOrigin: window.down_domain || window.str_down_domain || window.str_down_host || window.str_urldomain,
        fileFormat: typeof window.u_def_file !== "undefined" ? Number(window.u_def_file) : null,
        quotaAvailable: typeof window.quota_now !== "undefined" ? Number(window.quota_now) : null,
        quotaUsed: typeof window.quota_used !== "undefined" ? Number(window.quota_used) : null
      };
    }

    return getModuleData();
  }

  function collectData() {
    const pageData = getPageData();
    if (!pageData || !Array.isArray(pageData.arr) || !pageData.arr.length || !pageData.bookId) {
      return null;
    }

    const arr = mapVolumeData(pageData.arr);

    const payload = {
      bookId: pageData.bookId,
      arr: arr,
      title: document.querySelector(".text_bglight_big")?.textContent?.trim() || document.title,
      cover: document.querySelector(".img_book")?.src || "",
      author: Array.from(document.querySelectorAll("a[href*='list.php?s=']")).map((el) => el.textContent?.trim()).filter(Boolean),
      downPrefix: pageData.downPrefix || `/dl/${pageData.bookId}/`,
      downSuffix: pageData.downSuffix || "/0/",
      downloadOrigin: pageData.downloadOrigin || window.location.origin,
      fileFormat: pageData.fileFormat,
      quotaAvailable: pageData.quotaAvailable,
      quotaUsed: pageData.quotaUsed
    };
    return payload;
  }

  function sendPayload(force) {
    force = force || false;
    const payload = collectData();
    if (!payload) return;
    const key = payload.bookId + '-' + payload.arr.length;
    if (!force && key === lastPayloadKey) return;
    lastPayloadKey = key;
    window.postMessage(MESSAGE_PREFIX + JSON.stringify(payload), '*');
  }

  window.addEventListener('message', function(event) {
    if (event.source !== window || typeof event.data !== 'string') return;

    if (event.data.indexOf('volreload=') === 0) {
      observedVolData = [];
      lastPayloadKey = '';
      return;
    }

    if (event.data.indexOf('volinfo=') === 0) {
      const item = event.data.slice(8).split(',');
      if (item.length >= 15) {
        observedVolData.push(item);
        sendPayload(false);
      }
    }
  });

  const observer = new MutationObserver(function() { sendPayload(false); });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(function() { sendPayload(false); }, 2000);
  sendPayload(true);
})();
