// frontend/core/i18n-core.js
// 純函式：不依賴 DOM / localStorage，可於 Node 下單元測試。

/** 將 "你好 {name}" + {name:'A'} → "你好 A"；缺少的參數保留原樣 {key}。 */
export function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (m, k) =>
    (k in params && params[k] != null) ? String(params[k]) : m
  );
}

/**
 * 查字典翻譯。
 * @param {{en: Object<string,string>}} dict
 * @param {'zh'|'en'} lang
 * @param {string} zhKey 繁中原字串（呼叫端應已 trim）
 * @param {object} [params]
 * @returns {string} en 命中→英文；否則回填變數後的繁中原字串
 */
export function translate(dict, lang, zhKey, params) {
  if (lang === 'en' && dict && dict.en &&
      Object.prototype.hasOwnProperty.call(dict.en, zhKey)) {
    return interpolate(dict.en[zhKey], params);
  }
  return interpolate(zhKey, params);
}
