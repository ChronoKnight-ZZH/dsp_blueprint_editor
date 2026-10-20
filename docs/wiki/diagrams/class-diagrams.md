# 类图 — 核心数据结构与命令系统

## 1. 蓝图核心数据结构

```mermaid
classDiagram
    direction LR

    class BlueprintData {
        +BlueprintHeader header
        +int version
        +BlueprintArea[] areas
        +BlueprintBuilding[] buildings
        +int cursorOffset x y
        +int dragBoxSize x y
        +int cursorTargetArea
        +int primaryAreaIdx
        +BlueprintReformData? reformData
        +int? patch
        +byte[]? tailExtraBytes
    }

    class BlueprintHeader {
        +int icon1, icon2, icon3, icon4, icon5
        +int cursorX, cursorY
        +int cursorArea
        +int dragBoxX, dragBoxY
        +int time (高精度 tick)
        +string gameVersion
        +string shortDesc
        +string author?
        +string blueprintVersion?
        +string properties?
        +string desc
    }

    class BlueprintArea {
        +int parentIndex (-1 根)
        +int anchorLocalOffset x y
        +int size x y
        +float longitude
        +float latitude
        +int segment
        +int longitudeBase?
        +int longitudePeriod?
    }

    class BlueprintBuilding {
        +int index
        +int itemId
        +int modelIndex
        +int areaIndex
        +float localOffset x y
        +float[] yaw
        +float? tilt
        +float[]? v2ExtraPose
        +int outputObjIdx (default -1)
        +int inputObjIdx (default -1)
        +int outputToSlot
        +int inputFromSlot
        +int outputFromSlot
        +int inputToSlot
        +float outputOffset
        +float inputOffset
        +int recipeId
        +int filterId
        +AllParameters? parameters
        +string? content
    }

    class BlueprintReformData {
        +int reserved
        +BlueprintReformRect[] rects
        +uint32 customReformColorMask
        +uint32[] customReformColors
    }

    class BlueprintReformRect {
        +int reserved
        +int x y
        +int w h (max 255)
        +int type (0-7: type<<5)
        +int color (0-31: type<<5|color)
        +int areaIndex
    }

    BlueprintData --> BlueprintHeader : 1
    BlueprintData o-- BlueprintArea : areas[]
    BlueprintData o-- BlueprintBuilding : buildings[]
    BlueprintData o-- BlueprintReformData : reformData?
    BlueprintReformData o-- BlueprintReformRect : rects[]
```

### 关键说明

- `BlueprintBuilding.outputObjIdx = -1` 表示未连接，分拣器/传送带/建筑的连接关系全部靠这两个字段串联。
- `v2ExtraPose` 仅分拣器有，7 个 float（pose0, tip.x/y/z, yaw0, tilt, yaw1）。解析器原样保留，`pose[4]` 必须等于 `yaw[0]`，否则游戏报"分拣器角度偏移"（见 `blueprint/parser.ts` `importBuildingV2`）。
- `color` 字段 5-bit：0..15 游戏内置色，16..31 自定义色槽。`customReformColorMask` 的位 i 表示自定义槽 i 是否已设置。

---

## 2. 命令系统

```mermaid
classDiagram
    class Command {
        <<interface>>
        +do(data: BlueprintData, updater: Updater) void
        +undo(data: BlueprintData, updater: Updater) void
        +merge(c: Command) boolean
        +silent? boolean
    }

    class CommandQueue {
        -Command[] _stack
        -int _currentPosition
        -int _maxSize = 256
        +int stateVersion (readonly)
        +int execVersion (readonly)
        +push(c: Command) void
        +undo() void
        +redo() void
        -trim() void
    }

    class Updater {
        +EventDispatcher updateBuildingIcon
        +EventDispatcher updateBeltIcon
        +EventDispatcher updateBeltIconSubscript
        +EventDispatcher updateSorterIcon
        +EventDispatcher updateStationInfo
        +clearAll() void
    }

    class EventDispatcher {
        +on(fn) void
        +onMounted(fn) void
        +dispatch(args) void
        +clear() void
    }

    class ReplaceCommand {
        +do(data, updater)
        +undo(data, updater)
    }

    class RemoveBuildingCommand {
        +do(data, updater)
        +undo(data, updater)
    }

    class PaintReformCellCommand {
        +BlueprintReformRect rect (private)
        +do(data)
        +undo(data)
    }

    class SetReformCustomColorCommand {
        +do(data)
        +undo(data)
    }

    class CreateBuildingCommand {
        +do(data, updater)
        +undo(data, updater)
    }

    Command <|.. ReplaceCommand
    Command <|.. RemoveBuildingCommand
    Command <|.. PaintReformCellCommand
    Command <|.. SetReformCustomColorCommand
    Command <|.. CreateBuildingCommand

    CommandQueue o-- Command : _stack[]
    Updater o-- EventDispatcher : 5 个
    CommandQueue --> Updater : push/undo/redo 时传入
```

### 不变量

| 不变量 | 原因 |
| --- | --- |
| `silent=true` 命令不触发 `execVersion++` | 图标/颜色/文字改动不需要重几何 |
| silent 命令仍触发 `stateVersion++` | App.vue 需要 `codeExpired = true` 让蓝图字符串过期 |
| undo/redo 也要增 `stateVersion` | 撤销后蓝图字符串也变了 |
| undo/redo 非 silent 命令也要增 `execVersion` | 撤销后几何也要重建 |

参见 `src/command.ts` CommandQueue.push/undo/redo 实现。

---

## 3. 参数类型层次

```mermaid
classDiagram
    direction TB

    class AllParameters {
        <<union>>
    }

    class StationParameters {
        +StorageItem[] storage (maxItemKind)
        +StationSlot[] slots (12)
        +int workEnergyPerTick
        +int tripRangeOfDrones
        +int tripRangeOfShips
        +boolean includeOrbitCollector
        +int warpEnableDistance
        +boolean warperNecessary
    }

    class SplitterParameters {
        +boolean[4] priority
        +int[2] extra
    }

    class AssembleParamerters {
        +AcceleratorMode acceleratorMode
    }

    class LabParamerters {
        +ResearchMode researchMode
        +AcceleratorMode acceleratorMode
    }

    class BeltParameters {
        +int iconId
        +int count
    }

    class InserterParameters {
        +int length
    }

    class StorageParameters {
        +int automationLimit
        +StorageType type
        +int[]? grids
    }

    class MonitorParameters {
        +int tone
        +int volume
        +int pitch
        +boolean repeat
        +int length
        +float[] falloffRadius
    }

    AllParameters <|-- StationParameters
    AllParameters <|-- SplitterParameters
    AllParameters <|-- AssembleParamerters
    AllParameters <|-- LabParamerters
    AllParameters <|-- BeltParameters
    AllParameters <|-- InserterParameters
    AllParameters <|-- StorageParameters
    AllParameters <|-- MonitorParameters
    AllParameters <|-- TankParameters
    AllParameters <|-- BattleBaseParameters
    AllParameters <|-- DispenserParameters
    AllParameters <|-- UnknownParamerters
```
