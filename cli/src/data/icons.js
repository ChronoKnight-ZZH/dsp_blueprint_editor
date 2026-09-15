"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.allIconIds = exports.iconUrl = exports.techIconId = exports.recipeIconId = exports.itemIconId = exports.signalIconId = exports.signalIconUrl = exports.techIconUrl = exports.itemRecipeIconUrl = void 0;
const items_1 = require("./items");
const recipes_1 = require("./recipes");
async function itemRecipeIconUrl(name) {
    return (await Promise.resolve(`${`@/assets/icons/item_recipe/${name}.png`}`).then(s => __importStar(require(s)))).default;
}
exports.itemRecipeIconUrl = itemRecipeIconUrl;
async function techIconUrl(techId) {
    return (await Promise.resolve(`${`@/assets/icons/tech/${techId}.png`}`).then(s => __importStar(require(s)))).default;
}
exports.techIconUrl = techIconUrl;
async function signalIconUrl(signalId) {
    return (await Promise.resolve(`${`@/assets/icons/signal/signal-${signalId}.png`}`).then(s => __importStar(require(s)))).default;
}
exports.signalIconUrl = signalIconUrl;
function signalIconId(signalId) { return signalId; }
exports.signalIconId = signalIconId;
function itemIconId(itemId) { return itemId; }
exports.itemIconId = itemIconId;
function recipeIconId(recipeId) {
    const r = recipes_1.recipesMap.get(recipeId);
    if (r.icon)
        return recipeId + 20000;
    return itemIconId(r.to[0].item.id);
}
exports.recipeIconId = recipeIconId;
function techIconId(techId) { return techId + 40000; }
exports.techIconId = techIconId;
function iconUrl(iconId) {
    if (iconId < 1000)
        return signalIconUrl(iconId);
    if (iconId < 20000)
        return itemRecipeIconUrl(items_1.itemsMap.get(iconId).icon);
    if (iconId < 40000)
        return itemRecipeIconUrl(recipes_1.recipesMap.get(iconId - 20000).icon);
    if (iconId < 60000)
        return techIconUrl(iconId - 40000);
    throw new Error(`Unknown icon ${iconId}`);
}
exports.iconUrl = iconUrl;
function* allIconIds() {
    for (const i of items_1.itemsMap.values())
        yield itemIconId(i.id);
    for (const r of recipes_1.recipesMap.values()) {
        if (r.icon)
            yield recipeIconId(r.id);
    }
    for (const s of signalIconsData_1.signal) {
        yield signalIconId(s.id);
    }
    for (const t of techIconsData_1.tech) {
        yield techIconId(t.id);
    }
}
exports.allIconIds = allIconIds;
const techIconsData_1 = require("./techIconsData");
const signalIconsData_1 = require("./signalIconsData");
//# sourceMappingURL=icons.js.map