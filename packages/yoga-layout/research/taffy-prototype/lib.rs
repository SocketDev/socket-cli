/**
 * Yoga Layout WASM Bindings (Taffy-based)
 *
 * Size-optimized wasm-bindgen wrapper using Taffy (pure Rust flexbox engine).
 * Provides Yoga-compatible API for drop-in replacement with Ink and other Yoga consumers.
 *
 * Uses Taffy v0.6.0 - a modern, pure Rust implementation of flexbox layout.
 */

use wasm_bindgen::prelude::*;
use taffy::prelude::*;

/// Wrapper for Taffy Node with Yoga-compatible API.
#[wasm_bindgen]
pub struct YogaNode {
    taffy: TaffyTree,
    node: NodeId,
}

#[wasm_bindgen]
impl YogaNode {
    /// Create a new Yoga node.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut taffy = TaffyTree::new();
        let node = taffy.new_leaf(Style::default()).unwrap();
        YogaNode { taffy, node }
    }

    // ==========================================================================
    // Node tree management
    // ==========================================================================

    /// Insert a child node at the specified index.
    #[wasm_bindgen(js_name = insertChild)]
    pub fn insert_child(&mut self, child: &YogaNode, _index: u32) {
        let _ = self.taffy.add_child(self.node, child.node);
        // Note: Taffy doesn't support insertion at specific index in the same way.
        // Children are appended. For full compatibility, would need custom reordering.
    }

    /// Remove a child node.
    #[wasm_bindgen(js_name = removeChild)]
    pub fn remove_child(&mut self, child: &YogaNode) {
        let _ = self.taffy.remove_child(self.node, child.node);
    }

    /// Get the number of children.
    #[wasm_bindgen(js_name = getChildCount)]
    pub fn get_child_count(&self) -> u32 {
        self.taffy.children(self.node).map(|children| children.len()).unwrap_or(0) as u32
    }

    // ==========================================================================
    // Style setters
    // ==========================================================================

    /// Set width in points.
    #[wasm_bindgen(js_name = setWidth)]
    pub fn set_width(&mut self, width: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.size.width = length(width);
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set height in points.
    #[wasm_bindgen(js_name = setHeight)]
    pub fn set_height(&mut self, height: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.size.height = length(height);
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set min width in points.
    #[wasm_bindgen(js_name = setMinWidth)]
    pub fn set_min_width(&mut self, min_width: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.min_size.width = length(min_width);
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set min height in points.
    #[wasm_bindgen(js_name = setMinHeight)]
    pub fn set_min_height(&mut self, min_height: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.min_size.height = length(min_height);
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set max width in points.
    #[wasm_bindgen(js_name = setMaxWidth)]
    pub fn set_max_width(&mut self, max_width: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.max_size.width = length(max_width);
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set max height in points.
    #[wasm_bindgen(js_name = setMaxHeight)]
    pub fn set_max_height(&mut self, max_height: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.max_size.height = length(max_height);
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set flex direction (0=Column, 1=ColumnReverse, 2=Row, 3=RowReverse).
    #[wasm_bindgen(js_name = setFlexDirection)]
    pub fn set_flex_direction(&mut self, direction: u32) {
        let flex_dir = match direction {
            0 => FlexDirection::Column,
            1 => FlexDirection::ColumnReverse,
            2 => FlexDirection::Row,
            3 => FlexDirection::RowReverse,
            _ => FlexDirection::Column,
        };
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.flex_direction = flex_dir;
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set justify content (0=FlexStart, 1=Center, 2=FlexEnd, 3=SpaceBetween, 4=SpaceAround, 5=SpaceEvenly).
    #[wasm_bindgen(js_name = setJustifyContent)]
    pub fn set_justify_content(&mut self, justify: u32) {
        let justify_content = match justify {
            0 => Some(JustifyContent::Start),
            1 => Some(JustifyContent::Center),
            2 => Some(JustifyContent::End),
            3 => Some(JustifyContent::SpaceBetween),
            4 => Some(JustifyContent::SpaceAround),
            5 => Some(JustifyContent::SpaceEvenly),
            _ => Some(JustifyContent::Start),
        };
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.justify_content = justify_content;
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set align items (0=Auto, 1=FlexStart, 2=Center, 3=FlexEnd, 4=Stretch, 5=Baseline, 6=SpaceBetween, 7=SpaceAround).
    #[wasm_bindgen(js_name = setAlignItems)]
    pub fn set_align_items(&mut self, align: u32) {
        let align_items = match align {
            0 => Some(AlignItems::Start), // Auto → Start
            1 => Some(AlignItems::Start),
            2 => Some(AlignItems::Center),
            3 => Some(AlignItems::End),
            4 => Some(AlignItems::Stretch),
            5 => Some(AlignItems::Baseline),
            6 => Some(AlignItems::Start), // SpaceBetween not in AlignItems
            7 => Some(AlignItems::Start), // SpaceAround not in AlignItems
            _ => Some(AlignItems::Start),
        };
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.align_items = align_items;
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set align content (0=Auto, 1=FlexStart, 2=Center, 3=FlexEnd, 4=Stretch, 5=Baseline, 6=SpaceBetween, 7=SpaceAround).
    #[wasm_bindgen(js_name = setAlignContent)]
    pub fn set_align_content(&mut self, align: u32) {
        let align_content = match align {
            0 => Some(AlignContent::Start), // Auto → Start
            1 => Some(AlignContent::Start),
            2 => Some(AlignContent::Center),
            3 => Some(AlignContent::End),
            4 => Some(AlignContent::Stretch),
            5 => Some(AlignContent::Start), // Baseline not in AlignContent
            6 => Some(AlignContent::SpaceBetween),
            7 => Some(AlignContent::SpaceAround),
            _ => Some(AlignContent::Start),
        };
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.align_content = align_content;
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set align self (0=Auto, 1=FlexStart, 2=Center, 3=FlexEnd, 4=Stretch, 5=Baseline, 6=SpaceBetween, 7=SpaceAround).
    #[wasm_bindgen(js_name = setAlignSelf)]
    pub fn set_align_self(&mut self, align: u32) {
        let align_self = match align {
            0 => Some(AlignSelf::Start), // Auto → Start
            1 => Some(AlignSelf::Start),
            2 => Some(AlignSelf::Center),
            3 => Some(AlignSelf::End),
            4 => Some(AlignSelf::Stretch),
            5 => Some(AlignSelf::Baseline),
            6 => Some(AlignSelf::Start), // SpaceBetween not in AlignSelf
            7 => Some(AlignSelf::Start), // SpaceAround not in AlignSelf
            _ => Some(AlignSelf::Start),
        };
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.align_self = align_self;
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set flex wrap (0=NoWrap, 1=Wrap, 2=WrapReverse).
    #[wasm_bindgen(js_name = setFlexWrap)]
    pub fn set_flex_wrap(&mut self, wrap: u32) {
        let flex_wrap = match wrap {
            0 => FlexWrap::NoWrap,
            1 => FlexWrap::Wrap,
            2 => FlexWrap::WrapReverse,
            _ => FlexWrap::NoWrap,
        };
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.flex_wrap = flex_wrap;
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set flex shorthand property.
    #[wasm_bindgen(js_name = setFlex)]
    pub fn set_flex(&mut self, flex: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.flex_grow = flex;
        style.flex_shrink = 1.0;
        style.flex_basis = length(0.0);
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set flex grow.
    #[wasm_bindgen(js_name = setFlexGrow)]
    pub fn set_flex_grow(&mut self, flex_grow: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.flex_grow = flex_grow;
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set flex shrink.
    #[wasm_bindgen(js_name = setFlexShrink)]
    pub fn set_flex_shrink(&mut self, flex_shrink: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.flex_shrink = flex_shrink;
        let _ = self.taffy.set_style(self.node, style);
    }

    /// Set flex basis in points.
    #[wasm_bindgen(js_name = setFlexBasis)]
    pub fn set_flex_basis(&mut self, flex_basis: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        style.flex_basis = length(flex_basis);
        let _ = self.taffy.set_style(self.node, style);
    }

    // Padding (edge: 0=Left, 1=Top, 2=Right, 3=Bottom, 4=Start, 5=End, 6=Horizontal, 7=Vertical, 8=All).
    /// Set padding for a specific edge.
    #[wasm_bindgen(js_name = setPadding)]
    pub fn set_padding(&mut self, edge: u32, padding: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        let pad = length_pct(padding);
        match edge {
            0 => style.padding.left = pad,   // Left
            1 => style.padding.top = pad,    // Top
            2 => style.padding.right = pad,  // Right
            3 => style.padding.bottom = pad, // Bottom
            4 => style.padding.left = pad,   // Start → Left
            5 => style.padding.right = pad,  // End → Right
            6 => {
                // Horizontal
                style.padding.left = pad;
                style.padding.right = pad;
            }
            7 => {
                // Vertical
                style.padding.top = pad;
                style.padding.bottom = pad;
            }
            8 => {
                // All
                style.padding = Rect {
                    left: pad,
                    right: pad,
                    top: pad,
                    bottom: pad,
                };
            }
            _ => {}
        }
        let _ = self.taffy.set_style(self.node, style);
    }

    // Margin (edge: 0=Left, 1=Top, 2=Right, 3=Bottom, 4=Start, 5=End, 6=Horizontal, 7=Vertical, 8=All).
    /// Set margin for a specific edge.
    #[wasm_bindgen(js_name = setMargin)]
    pub fn set_margin(&mut self, edge: u32, margin: f32) {
        let mut style = self.taffy.style(self.node).unwrap().clone();
        let mar = length_auto(margin);
        match edge {
            0 => style.margin.left = mar,   // Left
            1 => style.margin.top = mar,    // Top
            2 => style.margin.right = mar,  // Right
            3 => style.margin.bottom = mar, // Bottom
            4 => style.margin.left = mar,   // Start → Left
            5 => style.margin.right = mar,  // End → Right
            6 => {
                // Horizontal
                style.margin.left = mar;
                style.margin.right = mar;
            }
            7 => {
                // Vertical
                style.margin.top = mar;
                style.margin.bottom = mar;
            }
            8 => {
                // All
                style.margin = Rect {
                    left: mar,
                    right: mar,
                    top: mar,
                    bottom: mar,
                };
            }
            _ => {}
        }
        let _ = self.taffy.set_style(self.node, style);
    }

    // ==========================================================================
    // Layout calculation
    // ==========================================================================

    /// Calculate layout with specified width and height.
    #[wasm_bindgen(js_name = calculateLayout)]
    pub fn calculate_layout(&mut self, width: f32, height: f32) {
        let available_space = Size {
            width: AvailableSpace::Definite(width),
            height: AvailableSpace::Definite(height),
        };
        let _ = self.taffy.compute_layout(self.node, available_space);
    }

    // ==========================================================================
    // Layout getters
    // ==========================================================================

    /// Get computed left position.
    #[wasm_bindgen(js_name = getComputedLeft)]
    pub fn get_computed_left(&self) -> f32 {
        self.taffy
            .layout(self.node)
            .map(|l| l.location.x)
            .unwrap_or(0.0)
    }

    /// Get computed top position.
    #[wasm_bindgen(js_name = getComputedTop)]
    pub fn get_computed_top(&self) -> f32 {
        self.taffy
            .layout(self.node)
            .map(|l| l.location.y)
            .unwrap_or(0.0)
    }

    /// Get computed width.
    #[wasm_bindgen(js_name = getComputedWidth)]
    pub fn get_computed_width(&self) -> f32 {
        self.taffy
            .layout(self.node)
            .map(|l| l.size.width)
            .unwrap_or(0.0)
    }

    /// Get computed height.
    #[wasm_bindgen(js_name = getComputedHeight)]
    pub fn get_computed_height(&self) -> f32 {
        self.taffy
            .layout(self.node)
            .map(|l| l.size.height)
            .unwrap_or(0.0)
    }

    /// Get computed right position.
    #[wasm_bindgen(js_name = getComputedRight)]
    pub fn get_computed_right(&self) -> f32 {
        self.taffy
            .layout(self.node)
            .map(|l| l.location.x + l.size.width)
            .unwrap_or(0.0)
    }

    /// Get computed bottom position.
    #[wasm_bindgen(js_name = getComputedBottom)]
    pub fn get_computed_bottom(&self) -> f32 {
        self.taffy
            .layout(self.node)
            .map(|l| l.location.y + l.size.height)
            .unwrap_or(0.0)
    }

    // ==========================================================================
    // Node hierarchy
    // ==========================================================================

    /// Get child at index.
    #[wasm_bindgen(js_name = getChild)]
    pub fn get_child(&self, _index: u32) -> Option<YogaNode> {
        // Note: wasm-bindgen doesn't support returning complex types easily.
        // For now, return None. Full implementation would need to track nodes in a registry.
        None
    }

    // ==========================================================================
    // Lifecycle management
    // ==========================================================================

    /// Free node resources (no-op in WASM - handled by garbage collection).
    #[wasm_bindgen]
    pub fn free(&self) {
        // No-op: WASM garbage collection handles memory.
    }

    /// Free node and all children recursively (no-op in WASM).
    #[wasm_bindgen(js_name = freeRecursive)]
    pub fn free_recursive(&self) {
        // No-op: WASM garbage collection handles memory.
    }

    /// Reset node to default style.
    #[wasm_bindgen]
    pub fn reset(&mut self) {
        let _ = self.taffy.set_style(self.node, Style::default());
    }
}

// Helper function to create a length dimension.
fn length(value: f32) -> Dimension {
    Dimension::Length(value)
}

// Helper function to create a length percentage (for padding).
fn length_pct(value: f32) -> LengthPercentage {
    LengthPercentage::Length(value)
}

// Helper function to create a length or auto dimension for margins.
fn length_auto(value: f32) -> LengthPercentageAuto {
    LengthPercentageAuto::Length(value)
}
