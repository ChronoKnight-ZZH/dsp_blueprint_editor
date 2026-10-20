# 时序图 — 关键工作流

## 1. 蓝图解析流程（fromStr）

用户粘贴蓝图字符串到右侧文本框，App.vue 调用 `parser.fromStr()` 解析。

```mermaid
sequenceDiagram
    actor User as 用户
    participant App as App.vue
    participant Parser as parser.fromStr()
    participant Reader as BufferReader
    participant MD5 as md5()
    participant Unzip as pako.ungzip()

    User->>App: 粘贴蓝图字符串
    App->>Parser: fromStr(strData)
    Note over Parser: 校验 "BLUEPRINT:" 前缀

    Parser->>Parser: split header cells
    Parser->>MD5: 校验尾部 md5("BLUEPRINT:...<quote>")
    alt MD5 不匹配
        MD5-->>Parser: 抛错 / 警告
        Parser-->>App: null + 错误提示
    end

    Parser->>Parser: base64 decode body
    Parser->>Unzip: pako.ungzip(bodyBytes)
    Unzip-->>Parser: 解压后的 Uint8Array

    Parser->>Reader: new BufferReader(gzipData)
    Reader->>Reader: getInt32() meta.version
    Reader->>Reader: getBytes() areas × 14B
    Reader->>Reader: getInt32() numBuildings

    loop 每个 building
        alt v2 (-102/-101 标记)
            Reader->>Reader: isV2RecordMarkerAt()
            Reader->>Reader: importBuildingV2()
            Note over Reader: 读 marker/index/itemId/model<br/>area/offset/yaw/tilt/pose<br/>params + content + extraBytes 原样保留
        else v1 (固定 61B)
            Reader->>Reader: importBuilding()
        end
    end

    Parser->>Reader: importTailV2()
    Note over Reader: v2 only: patch(int32)<br/>reformDataFlag(uint8)<br/>reformData? + tailExtraBytes?

    Parser-->>App: BlueprintData 实例
    App->>App: set blueprint 响应式 ref
    Note over App: BlueprintEditor.computed(b) 触发<br/>findPosForAreas → buildBuildings → buildBVH
```

## 2. 撤销重做流程

```mermaid
sequenceDiagram
    actor User as 用户
    participant Editor as BlueprintEditor.vue
    participant Queue as CommandQueue
    participant Cmd as Command (具体子类)
    participant Updater as Updater
    participant BP as BlueprintData

    User->>Editor: 右键删除建筑
    Editor->>Queue: push(new RemoveBuildingCommand(bp, index))
    Note over Queue: currentPosition 之后的命令丢弃

    Queue->>Cmd: do(BP, Updater)
    Cmd->>BP: 修改 buildings / 重排 index / 更新交叉引用

    alt cmd.merge 命中连续同类
        Queue->>Cmd: merge() → true
        Cmd-->>Queue: 不进栈，直接返回
    else 正常入栈
        Queue->>Queue: _stack.push(cmd), currentPosition++
    end

    Queue->>Queue: stateVersion++
    opt cmd.silent == false
        Queue->>Queue: execVersion++
    end

    Queue->>Updater: dispatch (如 updateBuildingIcon)
    Updater->>Editor: 局部刷新（如 UV 偏移重算）

    opt silent == false → execVersion 变了
        Editor->>Editor: computed(b) 重新计算
        Editor->>Editor: findPosForAreas + buildBuildings + buildBVH
        Editor->>Editor: dispose 旧 AllBuildings → 挂载新的
    end

    rect rgb(255, 243, 224)
        Note over User,Editor: 撤销
        User->>Editor: Ctrl+Z
        Editor->>Queue: undo()
        Queue->>Queue: currentPosition--
        Queue->>Cmd: undo(BP, Updater)
        Cmd->>BP: 恢复旧数据
        Queue->>Queue: stateVersion++
        opt cmd 原先是 non-silent
            Queue->>Queue: execVersion++
            Note over Editor: 重建场景
        end
    end
```

## 3. 照片转蓝图流程

用户点击 BuildingPalette 的"导入图片"按钮，上传图片生成像素地基蓝图。

```mermaid
sequenceDiagram
    actor User as 用户
    participant Palette as BuildingPalette.vue
    participant Img2BP as reformImage.ts
    participant Canvas as HTMLCanvasElement
    participant Quantize as medianCutQuantize()
    participant Build as buildBlueprintFromPixels()
    participant Create as createEmptyBlueprint()

    User->>Palette: 点击"导入图片" → 选文件
    Palette->>Img2BP: photoToBlueprint(Blob)

    Img2BP->>Img2BP: loadPhotoImage(Blob)
    Img2BP->>Canvas: scale = 160 / img.height
    Note over Canvas: cols = min(1000, round(w × scale))
    Canvas->>Canvas: translate(w, h); scale(-1, -1)
    Note over Canvas: 整体 180° 旋转 = 上下+左右镜像
    Canvas->>Img2BP: ImageData RGBA

    Img2BP->>Quantize: medianCutQuantize(unique, freqs, 16)
    Note over Quantize: 按频率加权中位切分<br/>每次切通道范围最大的 box<br/>每盒取加权平均色
    Quantize-->>Img2BP: ≤16 种代表色 RGB[]

    Img2BP->>Build: buildBlueprintFromPixels(pixels, w, h)
    Build->>Build: 调色板 = 内置 16 色 + 代表色 16 种
    loop 每格
        Build->>Build: nearestIndex(palette, pixel) → slotsPerCell
    end

    Build->>Build: buildRectsFromSlots()
    Note over Build: 行内 run-length 合并 w≤255<br/>纵向同 x/w/slot 合并 h≤255

    Build->>Create: createEmptyBlueprint()
    Create-->>Build: 空 BlueprintData (根区域 10×161)
    Build->>Build: 设置 areas[0].size = {w, h}
    Build->>Build: 写入 reformData.rects + customReformColors + mask

    Build-->>Img2BP: BlueprintData（像素地基蓝图）
    Img2BP-->>Palette: 返回 BlueprintData
    Palette->>Palette: 导入到当前编辑蓝图
```

## 4. 新建建筑命令（CreateBuildingCommand）

用户在放置模式下点击网格，编辑器用 defaultParamsFor 填参数，落位后完整索引管理。

```mermaid
sequenceDiagram
    actor User as 用户
    participant Editor as BlueprintEditor.vue
    participant CreateCmd as CreateBuildingCommand
    participant Default as defaultParamsFor()
    participant StackCheck as stacking.ts
    participant BP as BlueprintData
    participant Queue as CommandQueue

    User->>Editor: 放置模式下点击网格
    Editor->>Editor: planetToLocal → localOffset
    alt 堆叠放置
        Editor->>StackCheck: stackBaseFor(mousePos, childItemId)
        StackCheck-->>Editor: 底座建筑 + 堆叠高度 z
    end

    Editor->>Queue: push(new CreateBuildingCommand(bp, itemId, modelIndex, localOffset, z))
    Queue->>CreateCmd: do(BP, Updater)

    CreateCmd->>Default: defaultParamsFor(itemId, modelIndex)
    Default-->>CreateCmd: AllParameters 模板 | null
    Note over Default: 传送带 → null (游戏默认)<br/>分流器 → priority=[false×4]<br/>制造台 → {acceleratorMode: ExtraOutput}

    CreateCmd->>CreateCmd: new BlueprintBuilding(index, itemId, modelIndex...)
    opt 可堆叠建筑 (储物仓/分流器/集装机/喷涂机)
        CreateCmd->>CreateCmd: out=-1/14/15/0, in=-1/15/14/0
    end

    CreateCmd->>BP: buildings.push(newBuilding)
    opt 堆叠场景
        CreateCmd->>BP: inputObjIdx = 底座.index<br/>inputFromSlot=15, inputToSlot=14
    end

    Queue->>Queue: execVersion++ (non-silent)
    Note over Editor: computed(b) 触发重建 → buildBVH → update
```

## 5. 用户点击分流器设置优先输出

```mermaid
sequenceDiagram
    actor User as 用户
    participant SpitterInfo as SpitterInfo.vue
    participant Queue as CommandQueue
    participant PriCmd as SetSplitterPriorityCommand
    participant FilterCmd as SetSplitterFilterCommand
    participant BP as BlueprintData
    participant Updater as Updater

    User->>SpitterInfo: 左键点优先输出口（未设优先）
    SpitterInfo->>Queue: push(new SetSplitterPriorityCommand(bp, index, port, true))
    Queue->>PriCmd: do(BP, Updater)
    PriCmd->>BP: parameters.priority[port] = true
    Note over BP: 分流器 parameters.priority = [bool×4]

    opt 再次点击同一优先输出口
        User->>SpitterInfo: 左键点已优先的输出口
        SpitterInfo->>SpitterInfo: 打开 ItemSelect 筛选选择器
        User->>SpitterInfo: 选择物品 filterId
        SpitterInfo->>Queue: push(new SetSplitterFilterCommand(bp, index, filterId))
        Queue->>FilterCmd: do(BP, Updater)
        FilterCmd->>BP: filterId = 6001
        FilterCmd->>Updater: dispatch updateStationInfo
        Note over Updater: 只有优先输出口才挂筛选<br/>非 silent → execVersion++
    end

    opt 右键取消优先
        User->>SpitterInfo: 右键点已优先的口
        SpitterInfo->>Queue: push(new SetSplitterPriorityCommand(bp, index, port, false))
        Note over Queue: 若取消后已无优先输出口<br/>SetSplitterPriorityCommand 内部<br/>清空 filterId 一并撤掉
    end
```
