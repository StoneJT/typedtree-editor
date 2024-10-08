/**
 * @file Responsible for displaying tree nodes.
 */

import * as Tree from "../tree";
import * as TreeScheme from "../treescheme";
import * as Utils from "../utils";
import { Vector } from "../utils";
import * as Svg from "./svg";

// Let Typescript know that getCurrentScheme is exposed on the Window object.
declare global {
    interface Window {
        getCurrentScheme: () => TreeScheme.IScheme
    }
}

let copyConfig: {key: string, kind: string, nodeData: any} | null = null;

function copy (node: Tree.INode, field: Tree.Field | null) {
    if (node.type === Tree.noneNodeType) {
        alert("Cannot copy empty node");
        return;
    }
    const fieldKey = field?.name ?? "";
    const nodeData: {[key: string]: any} = Tree.Serializer.createObject(node);
    if (fieldKey && !nodeData[fieldKey]) {
        alert(`Could not copy from field "${fieldKey}"`);
        return;
    }
    copyConfig = {"key": field?.name ?? "", "kind": field?.kind ?? "node", "nodeData": nodeData};
}

function paste (field: Tree.Field, changed: fieldChangedCallback<Tree.Field>) {
    const scheme = window?.getCurrentScheme();
    if (!(copyConfig && scheme)) {
        return;
    }
    if (field.kind.indexOf(copyConfig.kind) === -1) {
        alert(`Cannot copy from "${copyConfig.kind}" source to "${field.kind}" destination.`);
        return;
    }
    const result = Tree.Parser.parseObject(copyConfig.nodeData);
    if (result.kind === "error") {
        alert(`Failed to parse tree. Error: ${result.errorMessage}`);
        return;
    }
    const existingValue = field.value;
    /*
     * The Tree.Serializer.createObject function excludes fields with empty array values,
     * and Tree.Parser.parseObject does not initialise with defaults for missing fields.
     * To avoid causing odd behaviours, we'll call duplicateWithMissingFields to ensure
     * that all nodes we paste conform to the current scheme.
     *
     * TODO: Investigate whether this can be more efficiently handled.
    */
    const copiedNode = TreeScheme.Instantiator.duplicateWithMissingFields(scheme, result.value);
    const newValue = copyConfig.key ? copiedNode.getField(copyConfig.key)?.value : copiedNode;
    const resolvedValue = Array.isArray(existingValue) ? existingValue.concat(newValue as Tree.FieldElementType<Tree.Field>) : newValue;
    changed(Tree.Modifications.fieldWithValue(field, resolvedValue as unknown as Tree.FieldValueType<Tree.Field>));
    copyConfig = null;
}

/** Callback for when a tree is changed, returns a new immutable tree. */
export type treeChangedCallback = (newTree: Tree.INode) => void;

/**
 * Draw the given tree.
 * @param scheme Scheme that the given tree follows.
 * @param root Root node for the tree to draw.
 * @param changed Callback that is invoked when the user changes the tree.
 */
export function setTree(
    scheme: TreeScheme.IScheme,
    root: Tree.INode | undefined,
    changed: treeChangedCallback | undefined): void {

    if (root === undefined) {
        Svg.setContent(undefined);
        return;
    }

    const typeLookup = TreeScheme.TypeLookup.createTypeLookup(scheme, root);
    const positionLookup = Tree.PositionLookup.createPositionLookup(root);

    Svg.setContent(b => {
        positionLookup.nodes.forEach(node => {
            createNode(b, node, typeLookup, positionLookup, scheme.features, newNode => {
                if (changed !== undefined) {
                    changed(Tree.Modifications.treeWithReplacedNode(root, node, newNode));
                }
            });
        });
    });
    Svg.setContentOffset(positionLookup.rootOffset);
}

/** Focus the given tree on the display. */
export function focusTree(maxScale?: number): void {
    Svg.focusContent(maxScale);
}

/**
 * Zoom on the tree, use positive delta for zooming-in and negative delta for zooming-out.
 * @param delta Number indicating how far to zoom. (Use negative numbers for zooming out)
 */
export function zoom(delta: number = 0.1): void {
    Svg.zoom(delta);
}

const nodeHeaderHeight = Tree.PositionLookup.nodeHeaderHeight;
const halfNodeHeaderHeight = Utils.half(nodeHeaderHeight);
const nodeNameHeight = Tree.PositionLookup.nodeNameHeight;
const nodeFieldHeight = Tree.PositionLookup.nodeFieldHeight;
const nodeInputSlotOffset: Vector.IVector2 = { x: 0, y: 12.5 };
const nodeTooltipSize: Vector.IVector2 = { x: 450, y: 75 };
const nodeContentPadding = 8;
const fieldNameWidth = 210;
const infoButtonSize = 20;
const nameButtonSize = 20;
const copyButtonSize = 20;
const nodeConnectionCurviness = .7;

type nodeChangedCallback = (newNode: Tree.INode) => void;

function createNode(
    builder: Svg.IBuilder,
    node: Tree.INode,
    typeLookup: TreeScheme.TypeLookup.ITypeLookup,
    positionLookup: Tree.PositionLookup.IPositionLookup,
    supportedFeatures: TreeScheme.Features,
    changed: nodeChangedCallback): void {

    let definition: TreeScheme.INodeDefinition | undefined;
    if (node.type !== Tree.noneNodeType) {
        definition = typeLookup.getDefinition(node);
    }
    const typeOptions = getTypeOptions(typeLookup, node);
    const typeOptionsIndex = typeOptions.findIndex(a => a === node.type);
    const size = positionLookup.getSize(node);
    const nodeElement = builder.addElement("node", positionLookup.getPosition(node));
    const backgroundClass = node.type === Tree.noneNodeType ? "nonenode-background" : "node-background";
    const allowName = node.type !== Tree.noneNodeType && (supportedFeatures & TreeScheme.Features.NodeNames) !== 0;

    // Add background.
    nodeElement.addRect(backgroundClass, size, Vector.zeroVector);

    let yOffset = 0;

    // Add name field.
    if (node.name !== undefined) {
        nodeElement.addEditableText("node-name", node.name,
            { x: Utils.half(nodeContentPadding), y: yOffset + Utils.half(nodeContentPadding) },
            { x: size.x - nodeContentPadding, y: nodeNameHeight - Utils.half(nodeContentPadding) },
            newName => { changed(Tree.Modifications.nodeWithName(node, newName)); });
        yOffset += nodeNameHeight;
    }

    const headerYOffset = yOffset;

    const copyButtonPosition: Vector.IVector2 = {
        x: size.x - Utils.half(nodeContentPadding) - nameButtonSize - Utils.half(copyButtonSize),
        y: halfNodeHeaderHeight + headerYOffset,
    };

    nodeElement.addGraphics("copypaste-button", "copy", copyButtonPosition, () => copy(node, null));

    // Add type dropdown.
    nodeElement.addDropdown("node-type", typeOptionsIndex, typeOptions,
        { x: infoButtonSize + Utils.half(nodeContentPadding), y: Utils.half(nodeContentPadding) + headerYOffset },
        { x: size.x - nodeContentPadding - infoButtonSize - nameButtonSize - copyButtonSize, y: nodeHeaderHeight - nodeContentPadding },
        newIndex => {
            const newNodeType = typeOptions[newIndex];
            const newNode = TreeScheme.Instantiator.changeNodeType(typeLookup.scheme, node, newNodeType);
            changed(newNode);
        });

    // Add name toggle button.
    if (allowName) {
        const nodeNameButtonSize: Vector.IVector2 = {
            x: size.x - Utils.half(nodeContentPadding) - Utils.half(nameButtonSize),
            y: halfNodeHeaderHeight + headerYOffset,
        };
        nodeElement.addGraphics("node-name-button", "name", nodeNameButtonSize, () => {
            changed(Tree.Modifications.nodeWithName(node, node.name === undefined ? "Unnamed" : undefined));
        });
    }

    yOffset += nodeHeaderHeight;

    // Add fields.
    node.fieldNames.forEach(fieldName => {
        yOffset += createField(node, definition, fieldName, nodeElement, positionLookup, yOffset, newField => {
            changed(Tree.Modifications.nodeWithField(node, newField));
        });
    });

    // Add tooltip.
    if (definition !== undefined && definition.comment !== undefined) {
        const infoElement = nodeElement.addElement("node-info", Vector.zeroVector);
        infoElement.addGraphics("node-info-button", "info", {
            x: Utils.half(nodeContentPadding) + Utils.half(infoButtonSize),
            y: halfNodeHeaderHeight + headerYOffset,
        });

        const toolTipElement = infoElement.addElement("node-tooltip", { x: 25, y: -25 });
        toolTipElement.addRect("node-tooltip-background", nodeTooltipSize, Vector.zeroVector);
        toolTipElement.addText("node-tooltip-text", definition.comment, { x: 0, y: 0 }, nodeTooltipSize);
    }
}

type fieldChangedCallback<T extends Tree.Field> = (newField: T) => void;

function createField(
    node: Tree.INode,
    nodeDefinition: TreeScheme.INodeDefinition | undefined,
    fieldName: string,
    parent: Svg.IElement,
    positionLookup: Tree.PositionLookup.IPositionLookup,
    baseYOffset: number,
    changed: fieldChangedCallback<Tree.Field>): number {

    const field = node.getField(fieldName);
    if (field === undefined) {
        return 0;
    }
    let fieldDefinition: TreeScheme.IFieldDefinition | undefined;
    if (nodeDefinition !== undefined) {
        fieldDefinition = nodeDefinition.getField(fieldName);
    }
    const fieldSize = { x: positionLookup.getSize(node).x, y: Tree.PositionLookup.getFieldHeight(field) };

    parent.addRect(`${field.kind}-value-background`, fieldSize, { x: 0, y: baseYOffset });

    const options = fieldDefinition === undefined ? TreeScheme.FieldOptions.None : fieldDefinition.options;
    if ((options & TreeScheme.FieldOptions.HideName) === 0) {
        parent.addText(
            "fieldname",
            `${field.name}:`,
            { x: Utils.half(nodeContentPadding), y: baseYOffset },
            { x: fieldNameWidth, y: nodeFieldHeight });
    }

    // Value
    switch (field.kind) {
        case "stringArray":
        case "numberArray":
        case "booleanArray":
        case "nodeArray":
            createArrayFieldValue(field, changed);
            break;
        default:
            createNonArrayFieldValue(field, changed);
            break;
    }
    return fieldSize.y;

    function createNonArrayFieldValue<T extends Tree.NonArrayField>(
        field: T,
        changed: fieldChangedCallback<T>): void {

        let xOffset = Utils.half(nodeContentPadding);
        if ((options & TreeScheme.FieldOptions.HideName) === 0) {
            xOffset += fieldNameWidth;
        }

        if (field.kind === "node") {
            const pos: Vector.Position = { x: xOffset, y: baseYOffset + Utils.half(nodeContentPadding) };
            const size: Vector.Size = { x: fieldSize.x - pos.x - Utils.half(nodeContentPadding), y: nodeFieldHeight - nodeContentPadding };
            const buttonPos = { x: pos.x + size.x - 30, y: pos.y + Utils.half(size.y) }
            parent.addGraphics("copypaste-button", "paste", buttonPos, () => paste(field, changed));
        }

        createElementValue(field.value, xOffset, 0, newElement => {
            changed(Tree.Modifications.fieldWithValue(field, newElement as Tree.FieldValueType<T>));
        });
    }

    function createArrayFieldValue<T extends Tree.ArrayField>(
        field: T,
        changed: fieldChangedCallback<T>): void {

        /* NOTE: There are some ugly casts here because the type-system cannot quite follow what
        we are doing here. */

        const array = field.value as ReadonlyArray<Tree.FieldElementType<T>>;

        let xOffset;
        if (field.kind === "nodeArray") {
            xOffset = fieldSize.x - 75;
        } else {
            // TODO: Pretty strange that we are overlapping the name field.
            xOffset = Utils.half(nodeContentPadding) + fieldNameWidth - 50;
        }

        // Add element button.
        parent.addGraphics("fieldvalue-button", "arrayAdd", { x: xOffset - 30, y: baseYOffset + Utils.half(nodeFieldHeight) }, () => {
            if (fieldDefinition === undefined) {
                throw new Error("Unable to create a new element without a FieldDefinition");
            }
            const newElement = TreeScheme.Instantiator.createNewElement(fieldDefinition.valueType);
            const newArray = array.concat(newElement as Tree.FieldElementType<T>);
            changed(Tree.Modifications.fieldWithValue(field, newArray as unknown as Tree.FieldValueType<T>));
        });

        let copyButtonPosition = { x: xOffset - 15, y: baseYOffset + Utils.half(nodeFieldHeight) };
        let pasteButtonPosition = { x: xOffset, y: baseYOffset + Utils.half(nodeFieldHeight) }

        parent.addGraphics("copypaste-button", "copy", copyButtonPosition, () => copy(node, field));
        parent.addGraphics("copypaste-button", "paste", pasteButtonPosition, () => paste(field, changed));

        for (let i = 0; i < field.value.length; i++) {
            const element = array[i];
            const yOffset = i * nodeFieldHeight;
            const yPos = baseYOffset + yOffset + Utils.half(nodeFieldHeight);

            // Element deletion button.
            parent.addGraphics("fieldvalue-button", "arrayDelete", { x: xOffset + 15, y: yPos }, () => {
                const newArray = Utils.withoutElement(array, i);
                changed(Tree.Modifications.fieldWithValue(field, newArray as unknown as Tree.FieldValueType<T>));
            });

            // Element duplicate button.
            parent.addGraphics("fieldvalue-button", "arrayDuplicate", { x: xOffset + 30, y: yPos }, () => {
                const newArray = Utils.withExtraElement(array, i,
                    field.kind === "nodeArray" ? Tree.Modifications.cloneNode(element as Tree.INode) : element);
                changed(Tree.Modifications.fieldWithValue(field, newArray as unknown as Tree.FieldValueType<T>));
            });

            // Reorder buttons.
            parent.addGraphics("fieldvalue-button", "arrayOrderUp", { x: xOffset + 43, y: yPos - 5 }, () => {
                // If item is the first then move it to the end, otherwise move it one toward the front.
                const newArray = i === 0 ?
                    Utils.withExtraElement(Utils.withoutElement(array, i), array.length - 1, array[0]) :
                    Utils.withSwappedElements(array, i, i - 1);
                changed(Tree.Modifications.fieldWithValue(field, newArray as unknown as Tree.FieldValueType<T>));
            });
            parent.addGraphics("fieldvalue-button", "arrayOrderDown", { x: xOffset + 43, y: yPos + 5 }, () => {
                // If the item is the last then move it to the front, otherwise move it one toward to end.
                const newArray = i === array.length - 1 ?
                    Utils.withExtraElement(Utils.withoutElement(array, i), 0, array[array.length - 1]) :
                    Utils.withSwappedElements(array, i, i + 1);
                changed(Tree.Modifications.fieldWithValue(field, newArray as unknown as Tree.FieldValueType<T>));
            });

            // Element value.
            createElementValue(element, xOffset + 50, yOffset, newElement => {
                changed(Tree.Modifications.fieldWithElement(field, newElement, i));
            });
        }
    }

    type elementChangedCallback<T extends Tree.FieldElement> = (newText: T) => void;

    function createElementValue<T extends Tree.FieldElement>(
        element: T,
        xOffset: number,
        yOffset: number,
        changed: elementChangedCallback<T>): void {

        const pos: Vector.Position = { x: xOffset, y: baseYOffset + yOffset + Utils.half(nodeContentPadding) };
        const size: Vector.Size = { x: fieldSize.x - pos.x - Utils.half(nodeContentPadding), y: nodeFieldHeight - nodeContentPadding };
        switch (typeof element) {
            case "string": createStringValue(element, pos, size, changed as elementChangedCallback<string>); break;
            case "number": createNumberValue(element, pos, size, changed as elementChangedCallback<number>); break;
            case "boolean": createBooleanValue(element, pos, size, changed as elementChangedCallback<boolean>); break;
            default: createNodeValue(element as Tree.INode, pos, size); break;
        }
    }

    function createStringValue(
        value: string,
        pos: Vector.Position,
        size: Vector.Size,
        changed: elementChangedCallback<string>): void {

        parent.addEditableText("string-value", value, pos, size, changed);
    }

    function createNumberValue(
        value: number,
        pos: Vector.Position,
        size: Vector.Size,
        changed: elementChangedCallback<number>): void {

        // If the number is an enumeration then display it as a dropdown.
        if (fieldDefinition !== undefined) {
            const enumeration = TreeScheme.validateEnumType(fieldDefinition.valueType);
            if (enumeration !== undefined) {
                const currentIndex = enumeration.values.findIndex(entry => entry.value === value);
                const options = enumeration.values.map(entry => `${entry.value}: ${entry.name}`);
                parent.addDropdown("enum-value", currentIndex, options, pos, size, newIndex => {
                    changed(enumeration.values[newIndex].value);
                });
                return;
            }
        }

        // Otherwise display it as a number input.
        parent.addEditableNumber("number-value", value, pos, size, changed);
    }

    function createBooleanValue(
        value: boolean,
        pos: Vector.Position,
        size: Vector.Size,
        changed: elementChangedCallback<boolean>): void {

        parent.addEditableBoolean("boolean-value", value, pos, size, changed);
    }

    function createNodeValue(
        value: Tree.INode,
        pos: Vector.Position,
        size: Vector.Size): void {

        addConnection(parent,
            { x: pos.x + size.x - 12, y: pos.y + Utils.half(size.y) },
            getRelativeVector(node, value, positionLookup));
    }
}

function addConnection(parent: Svg.IElement, from: Vector.Position, to: Vector.Position): void {
    parent.addGraphics("nodeOutput", "nodeConnector", from);

    const target = Vector.add(to, nodeInputSlotOffset);
    const c1 = { x: Utils.lerp(from.x, target.x, nodeConnectionCurviness), y: from.y };
    const c2 = { x: Utils.lerp(target.x, from.x, nodeConnectionCurviness), y: target.y };
    parent.addBezier("connection", from, c1, c2, target);
}

function getRelativeVector(
    from: Tree.INode,
    to: Tree.INode,
    positionLookup: Tree.PositionLookup.IPositionLookup): Vector.IVector2 {

    return Vector.subtract(positionLookup.getPosition(to), positionLookup.getPosition(from));
}

function getTypeOptions(typeLookup: TreeScheme.TypeLookup.ITypeLookup, node: Tree.INode): Tree.NodeType[] {
    const alias = typeLookup.getAlias(node);
    const result = alias.values.slice();
    // Add the none-type
    result.unshift(Tree.noneNodeType);
    return result;
}
