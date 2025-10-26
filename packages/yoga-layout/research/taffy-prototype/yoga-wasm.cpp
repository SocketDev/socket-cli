/**
 * Yoga Layout WASM Wrapper
 *
 * Minimal Emscripten bindings for Yoga Layout engine.
 * Exposes essential flexbox layout API to JavaScript.
 */

#include <emscripten/bind.h>
#include <yoga/Yoga.h>

using namespace emscripten;

// Wrapper class for YGNode to provide RAII and JavaScript-friendly API.
class YogaNode {
private:
  YGNodeRef node;
  bool ownsNode;

public:
  YogaNode() : node(YGNodeNew()), ownsNode(true) {}

  explicit YogaNode(YGNodeRef existingNode)
      : node(existingNode), ownsNode(false) {}

  ~YogaNode() {
    if (ownsNode && node) {
      YGNodeFree(node);
    }
  }

  // Prevent copying.
  YogaNode(const YogaNode &) = delete;
  YogaNode &operator=(const YogaNode &) = delete;

  // Node tree management.
  void insertChild(YogaNode *child, uint32_t index) {
    YGNodeInsertChild(node, child->node, index);
  }

  void removeChild(YogaNode *child) { YGNodeRemoveChild(node, child->node); }

  uint32_t getChildCount() const { return YGNodeGetChildCount(node); }

  // Style setters.
  void setWidth(float width) { YGNodeStyleSetWidth(node, width); }

  void setHeight(float height) { YGNodeStyleSetHeight(node, height); }

  void setMinWidth(float minWidth) { YGNodeStyleSetMinWidth(node, minWidth); }

  void setMinHeight(float minHeight) {
    YGNodeStyleSetMinHeight(node, minHeight);
  }

  void setMaxWidth(float maxWidth) { YGNodeStyleSetMaxWidth(node, maxWidth); }

  void setMaxHeight(float maxHeight) {
    YGNodeStyleSetMaxHeight(node, maxHeight);
  }

  void setFlexDirection(int direction) {
    YGNodeStyleSetFlexDirection(node, static_cast<YGFlexDirection>(direction));
  }

  void setJustifyContent(int justify) {
    YGNodeStyleSetJustifyContent(node, static_cast<YGJustify>(justify));
  }

  void setAlignItems(int align) {
    YGNodeStyleSetAlignItems(node, static_cast<YGAlign>(align));
  }

  void setAlignContent(int align) {
    YGNodeStyleSetAlignContent(node, static_cast<YGAlign>(align));
  }

  void setAlignSelf(int align) {
    YGNodeStyleSetAlignSelf(node, static_cast<YGAlign>(align));
  }

  void setFlexWrap(int wrap) {
    YGNodeStyleSetFlexWrap(node, static_cast<YGWrap>(wrap));
  }

  void setFlex(float flex) { YGNodeStyleSetFlex(node, flex); }

  void setFlexGrow(float flexGrow) { YGNodeStyleSetFlexGrow(node, flexGrow); }

  void setFlexShrink(float flexShrink) {
    YGNodeStyleSetFlexShrink(node, flexShrink);
  }

  void setFlexBasis(float flexBasis) {
    YGNodeStyleSetFlexBasis(node, flexBasis);
  }

  // Padding.
  void setPadding(int edge, float padding) {
    YGNodeStyleSetPadding(node, static_cast<YGEdge>(edge), padding);
  }

  // Margin.
  void setMargin(int edge, float margin) {
    YGNodeStyleSetMargin(node, static_cast<YGEdge>(edge), margin);
  }

  // Layout calculation.
  void calculateLayout(float width, float height) {
    YGNodeCalculateLayout(node, width, height, YGDirectionLTR);
  }

  // Layout getters.
  float getComputedLeft() const { return YGNodeLayoutGetLeft(node); }

  float getComputedTop() const { return YGNodeLayoutGetTop(node); }

  float getComputedWidth() const { return YGNodeLayoutGetWidth(node); }

  float getComputedHeight() const { return YGNodeLayoutGetHeight(node); }
};

// Emscripten bindings.
EMSCRIPTEN_BINDINGS(yoga) {
  class_<YogaNode>("YogaNode")
      .constructor<>()
      .function("insertChild", &YogaNode::insertChild, allow_raw_pointers())
      .function("removeChild", &YogaNode::removeChild, allow_raw_pointers())
      .function("getChildCount", &YogaNode::getChildCount)
      .function("setWidth", &YogaNode::setWidth)
      .function("setHeight", &YogaNode::setHeight)
      .function("setMinWidth", &YogaNode::setMinWidth)
      .function("setMinHeight", &YogaNode::setMinHeight)
      .function("setMaxWidth", &YogaNode::setMaxWidth)
      .function("setMaxHeight", &YogaNode::setMaxHeight)
      .function("setFlexDirection", &YogaNode::setFlexDirection)
      .function("setJustifyContent", &YogaNode::setJustifyContent)
      .function("setAlignItems", &YogaNode::setAlignItems)
      .function("setAlignContent", &YogaNode::setAlignContent)
      .function("setAlignSelf", &YogaNode::setAlignSelf)
      .function("setFlexWrap", &YogaNode::setFlexWrap)
      .function("setFlex", &YogaNode::setFlex)
      .function("setFlexGrow", &YogaNode::setFlexGrow)
      .function("setFlexShrink", &YogaNode::setFlexShrink)
      .function("setFlexBasis", &YogaNode::setFlexBasis)
      .function("setPadding", &YogaNode::setPadding)
      .function("setMargin", &YogaNode::setMargin)
      .function("calculateLayout", &YogaNode::calculateLayout)
      .function("getComputedLeft", &YogaNode::getComputedLeft)
      .function("getComputedTop", &YogaNode::getComputedTop)
      .function("getComputedWidth", &YogaNode::getComputedWidth)
      .function("getComputedHeight", &YogaNode::getComputedHeight);

  // Enums for flex direction.
  enum_<YGFlexDirection>("FlexDirection")
      .value("Column", YGFlexDirectionColumn)
      .value("ColumnReverse", YGFlexDirectionColumnReverse)
      .value("Row", YGFlexDirectionRow)
      .value("RowReverse", YGFlexDirectionRowReverse);

  // Enums for justify content.
  enum_<YGJustify>("Justify")
      .value("FlexStart", YGJustifyFlexStart)
      .value("Center", YGJustifyCenter)
      .value("FlexEnd", YGJustifyFlexEnd)
      .value("SpaceBetween", YGJustifySpaceBetween)
      .value("SpaceAround", YGJustifySpaceAround)
      .value("SpaceEvenly", YGJustifySpaceEvenly);

  // Enums for align.
  enum_<YGAlign>("Align")
      .value("Auto", YGAlignAuto)
      .value("FlexStart", YGAlignFlexStart)
      .value("Center", YGAlignCenter)
      .value("FlexEnd", YGAlignFlexEnd)
      .value("Stretch", YGAlignStretch)
      .value("Baseline", YGAlignBaseline)
      .value("SpaceBetween", YGAlignSpaceBetween)
      .value("SpaceAround", YGAlignSpaceAround);

  // Enums for wrap.
  enum_<YGWrap>("Wrap")
      .value("NoWrap", YGWrapNoWrap)
      .value("Wrap", YGWrapWrap)
      .value("WrapReverse", YGWrapWrapReverse);

  // Enums for edge.
  enum_<YGEdge>("Edge")
      .value("Left", YGEdgeLeft)
      .value("Top", YGEdgeTop)
      .value("Right", YGEdgeRight)
      .value("Bottom", YGEdgeBottom)
      .value("Start", YGEdgeStart)
      .value("End", YGEdgeEnd)
      .value("Horizontal", YGEdgeHorizontal)
      .value("Vertical", YGEdgeVertical)
      .value("All", YGEdgeAll);
}
