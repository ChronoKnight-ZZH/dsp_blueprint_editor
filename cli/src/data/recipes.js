"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recipesMap = void 0;
const recipesData_1 = require("./recipesData");
exports.recipesMap = new Map();
for (const i of recipesData_1.recipes) {
    exports.recipesMap.set(i.id, i);
}
//# sourceMappingURL=recipes.js.map