// utils/ime.js — 輸入法（注音／拼音／倉頡…）組字狀態判斷
//
// 打中文時，選字／送出組字也是按 Enter。這顆 Enter 是給輸入法的，不是「送出表單」：
// 如果 keydown 處理器照樣當成送出，字還沒選完就被送出去，看起來就像「打不了中文」。
// 組字中的按鍵 isComposing 為 true；部分 WebKit 版本只給 keyCode 229，所以兩個都看。
export function isImeComposing(event) {
    return Boolean(event && (event.isComposing || event.keyCode === 229));
}
