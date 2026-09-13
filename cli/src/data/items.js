"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allAssemblers = exports.isDispenser = exports.isBattleBase = exports.isMonitor = exports.isAdvancedMiningMachine = exports.isEnergyExchanger = exports.isArtificialStar = exports.isRayReciver = exports.isEjector = exports.isTank = exports.isStorage = exports.isLab = exports.isSplitter = exports.isInterstellarStation = exports.isStation = exports.isInserter = exports.isBelt = exports.itemsMap = void 0;
const itemsData_1 = require("./itemsData");
exports.itemsMap = new Map();
for (const i of itemsData_1.items) {
    exports.itemsMap.set(i.id, i);
}
function isBelt(id) {
    return id >= 2001 && id <= 2003;
}
exports.isBelt = isBelt;
function isInserter(id) {
    return id >= 2011 && id <= 2014;
}
exports.isInserter = isInserter;
function isStation(id) {
    return id === 2103 || id === 2104 || id === 2316;
}
exports.isStation = isStation;
function isInterstellarStation(id) {
    return id === 2104;
}
exports.isInterstellarStation = isInterstellarStation;
function isSplitter(id) {
    return id === 2020;
}
exports.isSplitter = isSplitter;
function isLab(id) {
    return id === 2901 || id === 2902;
}
exports.isLab = isLab;
function isStorage(id) {
    return id === 2101 || id === 2102 || id === 3009;
}
exports.isStorage = isStorage;
function isTank(id) {
    return id === 2106;
}
exports.isTank = isTank;
function isEjector(id) {
    return id === 2311;
}
exports.isEjector = isEjector;
function isRayReciver(id) {
    return id === 2208;
}
exports.isRayReciver = isRayReciver;
function isArtificialStar(id) {
    return id === 2210;
}
exports.isArtificialStar = isArtificialStar;
function isEnergyExchanger(id) {
    return id === 2209;
}
exports.isEnergyExchanger = isEnergyExchanger;
function isAdvancedMiningMachine(id) {
    return id === 2316;
}
exports.isAdvancedMiningMachine = isAdvancedMiningMachine;
function isMonitor(id) {
    return id === 2030;
}
exports.isMonitor = isMonitor;
function isBattleBase(id) {
    return id === 3009;
}
exports.isBattleBase = isBattleBase;
function isDispenser(id) {
    return id === 2107;
}
exports.isDispenser = isDispenser;
exports.allAssemblers = new Set([
    2303, // 制造台
    2304,
    2305,
    2318,
    2302, // 熔炉
    2315,
    2319,
    2308, // 原油精炼厂
    2309, // 化工厂
    2317,
    2310, // 对撞机
    2901, // 研究站
    2902,
]);
//# sourceMappingURL=items.js.map