"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplaceCommand = void 0;
const recipes_1 = require("@/data/recipes");
const items_1 = require("@/data/items");
const icons_1 = require("@/data/icons");
class ReplaceCommand {
    recipeBuildings = [];
    filterBuildings = [];
    stationStorage = [];
    beltBuildings = [];
    blueprintIconIndex = [];
    searchRecipeId;
    replaceRecipeId;
    constructor(bp, params) {
        this.searchRecipeId = params.searchRecipe;
        this.replaceRecipeId = params.replaceRecipe;
        const searchRecipe = recipes_1.recipesMap.get(params.searchRecipe);
        if (!searchRecipe)
            throw new Error(`Unknown search recipe ${params.searchRecipe}`);
        const searchItem = searchRecipe.to[0].item.id;
        const searchIcon = (0, icons_1.recipeIconId)(params.searchRecipe);
        for (const b of bp.buildings) {
            if (params.scope.recipe)
                if (b.recipeId === params.searchRecipe)
                    this.recipeBuildings.push(b);
            if (params.scope.filter)
                if (b.filterId === searchItem)
                    this.filterBuildings.push(b);
            if (params.scope.beltIcon && (0, items_1.isBelt)(b.itemId)) {
                const p = b.parameters;
                if (p?.iconId === searchIcon)
                    this.beltBuildings.push(b);
            }
            if (params.scope.station && (0, items_1.isStation)(b.itemId)) {
                this.stationStorage.push(...b.parameters.storage
                    .filter(s => s.itemId === searchItem)
                    .map((s, i) => ({ b, i })));
            }
        }
        if (params.scope.blueprintIcon) {
            const icons = bp.header.icons;
            for (let i = 0; i < icons.length; i++)
                if (icons[i] === searchIcon)
                    this.blueprintIconIndex.push(i);
        }
    }
    replace(recipeId, data, updater) {
        const recipe = recipes_1.recipesMap.get(recipeId);
        if (!recipe)
            throw new Error(`Unknown recipe ${recipeId}`);
        const item = recipe.to[0].item.id;
        const icon = (0, icons_1.recipeIconId)(recipeId);
        for (const b of this.recipeBuildings) {
            b.recipeId = recipeId;
            updater.updateBuildingIcon.dispatch(b);
        }
        for (const b of this.filterBuildings) {
            b.filterId = item;
            updater.updateSorterIcon.dispatch(b);
        }
        for (const b of this.beltBuildings) {
            b.parameters.iconId = icon;
            updater.updateBeltIcon.dispatch(b);
        }
        for (const { b, i } of this.stationStorage) {
            b.parameters.storage[i].itemId = item;
            updater.updateStationInfo.dispatch(b);
        }
        for (const i of this.blueprintIconIndex)
            data.header.icons[i] = icon;
    }
    do(data, updater) {
        this.replace(this.replaceRecipeId, data, updater);
    }
    undo(data, updater) {
        this.replace(this.searchRecipeId, data, updater);
    }
    merge() { return false; }
}
exports.ReplaceCommand = ReplaceCommand;
//# sourceMappingURL=replace.js.map