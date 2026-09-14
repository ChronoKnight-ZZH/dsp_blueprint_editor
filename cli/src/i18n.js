"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recipeName = exports.itemName = exports.useLang = void 0;
const vue_i18n_1 = require("vue-i18n");
const zh_json_1 = __importDefault(require("./locales/zh.json"));
const en_json_1 = __importDefault(require("./locales/en.json"));
const vue_1 = require("vue");
const data_1 = require("./data");
const i18n = (0, vue_i18n_1.createI18n)({
    legacy: false,
    locale: 'en',
    fallbackLocale: [...navigator.languages, 'en'],
    messages: {
        zh: zh_json_1.default,
        en: en_json_1.default,
    },
});
function useLang() {
    const lang = (0, vue_1.ref)('auto');
    (0, vue_1.watchEffect)(() => {
        const locale = i18n.global.locale;
        if (lang.value === 'auto') {
            // if navigator language is not supported, fallback will be used
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            locale.value = navigator.language;
        }
        else {
            locale.value = lang.value;
        }
    });
    return lang;
}
exports.useLang = useLang;
exports.default = i18n;
function itemName(id) {
    const item = data_1.itemsMap.get(id);
    return item ? i18n.global.t(item.name) : 'unknown';
}
exports.itemName = itemName;
function recipeName(id) {
    const r = data_1.recipesMap.get(id);
    return r ? i18n.global.t(r.name) : 'unknown';
}
exports.recipeName = recipeName;
//# sourceMappingURL=i18n.js.map