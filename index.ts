; (window as any).onNativeDialogResult = function (confirmed: boolean) {
  if (dialogResolver) {
    dialogResolver(confirmed);
    dialogResolver = null;
  }
};

let isWriting = false;

// Handle the "beforeunload" event to stop reloads
if (typeof window !== "undefined") {
  window.addEventListener('beforeunload', (e) => {
    if (isWriting) {
      // Standard way to trigger a "Confirm Reload" dialog
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/**
 * Called by Android
 */
; (window as any).onNativePermissionResult = function (granted: boolean) {
  if (permissionResolver) {
    permissionResolver(granted);
    permissionResolver = null;
  }
};
const ANDROID_KEY_MAP: Record<number, string> = {
  19: "ArrowUp",    // DPAD_UP
  20: "ArrowDown",  // DPAD_DOWN
  21: "ArrowLeft",  // DPAD_LEFT
  22: "ArrowRight", // DPAD_RIGHT
  23: "Enter",      // DPAD_CENTER
  4: "Back",        // BACK
};
// Already have this: 
// New: Android bridge
// @ts-ignore
window.onNativeKey = function (keyCode: number) {
  const key = ANDROID_KEY_MAP[keyCode];
  if (!key) return;
  // add debug element to show key presses
  const debugElement = document.getElementById("debug-keypress");
  if (debugElement) {
    debugElement.textContent = `Key pressed: ${key}`;
  }

  // Create a fake KeyboardEvent so FocusManager can handle it
  const event = new KeyboardEvent("keydown", { key });
  document.dispatchEvent(event);
};
let nextUnitOfWork: Fiber | null = null;
let wipRoot: Fiber | null = null;
let currentRoot: Fiber | null = null;
let deletions: Fiber[] | null = null;
let wipFiber: Fiber | null = null;
let hookIndex = 0;
let isRenderScheduled = false;
/**
* FocusManager - Handles D-pad navigation and focus management
*/
class FocusManager {
  constructor() {
    this.focusableSelectors = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      '[tabindex]',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="option"]',
      '[contenteditable="true"]'
    ];
    this.currentFocusIndex = -1;
    this.focusableElements = [];
    this.isEnabled = true;
    this.debug = false;

    this.init();
  }

  init() {
    // Listen for the keyboard events dispatched by onNativeKey
    document.addEventListener('keydown', this.handleKeyDown.bind(this));

    // Update focusable elements when DOM changes
    this.observeDOMChanges();

    // Initial focusable elements scan
    this.updateFocusableElements();

    // Try to focus first element by default
    setTimeout(() => {
      if (this.focusableElements.length > 0) {
        this.setFocusIndex(0);
      }
    }, 100);

    // Debug visualization
    if (this.debug) {
      this.addDebugStyles();
    }
  }

  handleKeyDown(event) {
    if (!this.isEnabled) return;

    const key = event.key;

    switch (key) {
      case 'ArrowUp':
        event.preventDefault();
        this.navigate(-1, 'vertical');
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.navigate(1, 'vertical');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.navigate(-1, 'horizontal');
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.navigate(1, 'horizontal');
        break;
      case 'Enter':
        event.preventDefault();
        this.activateCurrentElement();
        break;
      case 'Back':
        event.preventDefault();
        this.handleBackButton();
        break;
    }
  }

  updateFocusableElements() {
    const allElements = Array.from(document.querySelectorAll(this.focusableSelectors.join(',')));

    // Filter elements that are visible and not disabled
    this.focusableElements = allElements.filter(el => {
      const style = window.getComputedStyle(el);
      const isVisible = style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0';
      const isEnabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';
      const hasTabIndex = el.tabIndex !== -1 || el.hasAttribute('tabindex');

      return isVisible && isEnabled && (hasTabIndex || this.isFocusableByDefault(el));
    });

    // Sort by visual position (top-to-bottom, left-to-right)
    this.focusableElements.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();

      if (Math.abs(rectA.top - rectB.top) < 10) {
        return rectA.left - rectB.left;
      }
      return rectA.top - rectB.top;
    });

    // Update current focus index if current element still exists
    if (this.currentFocusIndex >= 0) {
      const currentElement = this.getCurrentElement();
      if (currentElement) {
        this.currentFocusIndex = this.focusableElements.indexOf(currentElement);
      }
    }

    if (this.currentFocusIndex === -1 && this.focusableElements.length > 0) {
      this.currentFocusIndex = 0;
    }

    if (this.debug) {
      this.highlightFocusableElements();
    }
  }

  isFocusableByDefault(element) {
    return ['button', 'a[href]', 'input', 'select', 'textarea'].some(selector =>
      element.matches(selector)
    );
  }

  navigate(direction, orientation) {
    if (this.focusableElements.length === 0) return;

    const currentElement = this.getCurrentElement();
    if (!currentElement && this.focusableElements.length > 0) {
      this.setFocusIndex(0);
      return;
    }

    const currentIndex = this.focusableElements.indexOf(currentElement);
    const currentRect = currentElement.getBoundingClientRect();

    let bestCandidate = null;
    let bestScore = Infinity;

    this.focusableElements.forEach((element, index) => {
      if (index === currentIndex) return;

      const rect = element.getBoundingClientRect();
      let score = 0;

      if (orientation === 'vertical') {
        const verticalDistance = direction > 0 ?
          rect.top - currentRect.bottom :
          currentRect.top - rect.bottom;

        const horizontalDistance = Math.abs((rect.left + rect.right) / 2 -
          (currentRect.left + currentRect.right) / 2);

        if (verticalDistance < 0) return; // Wrong direction

        // Prioritize elements directly below/above, then consider horizontal alignment
        score = verticalDistance + horizontalDistance * 0.3;
      } else { // horizontal
        const horizontalDistance = direction > 0 ?
          rect.left - currentRect.right :
          currentRect.left - rect.right;

        const verticalDistance = Math.abs((rect.top + rect.bottom) / 2 -
          (currentRect.top + currentRect.bottom) / 2);

        if (horizontalDistance < 0) return; // Wrong direction

        // Prioritize elements directly right/left, then consider vertical alignment
        score = horizontalDistance + verticalDistance * 0.3;
      }

      if (score < bestScore) {
        bestScore = score;
        bestCandidate = index;
      }
    });

    // If no candidate found in primary direction, try opposite direction
    if (bestCandidate === null && this.focusableElements.length > 1) {
      const nextIndex = (currentIndex + direction + this.focusableElements.length) %
        this.focusableElements.length;
      bestCandidate = nextIndex;
    }

    if (bestCandidate !== null) {
      this.setFocusIndex(bestCandidate);
    }
  }

  setFocusIndex(index) {
    if (index < 0 || index >= this.focusableElements.length) return;

    this.currentFocusIndex = index;
    const element = this.focusableElements[index];

    // Remove focus from all elements
    this.focusableElements.forEach(el => {
      el.classList.remove('focused', 'dpad-focused');
      el.removeAttribute('data-focused');
    });

    // Add focus to current element
    element.classList.add('focused', 'dpad-focused');
    element.setAttribute('data-focused', 'true');
    element.focus();

    // Scroll into view if needed
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });

    // Dispatch custom event
    element.dispatchEvent(new CustomEvent('dpadfocus', {
      bubbles: true,
      detail: { element, index }
    }));

    if (this.debug) {
      console.log('Focused element:', element, 'Index:', index);
    }
  }

  getCurrentElement() {
    return this.focusableElements[this.currentFocusIndex];
  }

  activateCurrentElement() {
    const element = this.getCurrentElement();
    if (!element) return;

    // Trigger appropriate action based on element type
    if (element.tagName === 'A' || element.tagName === 'BUTTON') {
      element.click();
    } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      // Already focused, just ensure it's active
      element.focus();
    } else {
      // Generic click for other focusable elements
      element.click();
    }
  }

  handleBackButton() {
    // Dispatch global back event
    document.dispatchEvent(new CustomEvent('dpadback', {
      bubbles: true
    }));

    // Or go back in history
    if (window.history.length > 1) {
      window.history.back();
    }
  }

  observeDOMChanges() {
    // Use MutationObserver to update focusable elements when DOM changes
    const observer = new MutationObserver(() => {
      this.updateFocusableElements();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'disabled', 'tabindex']
    });

    // Also update on resize and scroll
    window.addEventListener('resize', () => this.updateFocusableElements());
    window.addEventListener('scroll', () => this.updateFocusableElements());
  }

  // Debug methods
  addDebugStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .dpad-focused {
        outline: 3px solid #4CAF50 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.3) !important;
        transition: outline 0.2s ease;
      }
      
      .focus-highlight {
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        z-index: 9999;
      }
    `;
    document.head.appendChild(style);
  }

  highlightFocusableElements() {
    // Remove existing highlights
    document.querySelectorAll('.focus-highlight').forEach(el => el.remove());

    // Add highlight element
    const highlight = document.createElement('div');
    highlight.className = 'focus-highlight';
    highlight.textContent = `Focusable: ${this.focusableElements.length} | Current: ${this.currentFocusIndex}`;
    document.body.appendChild(highlight);
  }

  // Public API
  enable() {
    this.isEnabled = true;
  }

  disable() {
    this.isEnabled = false;
  }

  focusFirst() {
    if (this.focusableElements.length > 0) {
      this.setFocusIndex(0);
    }
  }

  focusLast() {
    if (this.focusableElements.length > 0) {
      this.setFocusIndex(this.focusableElements.length - 1);
    }
  }

  focusElement(element) {
    const index = this.focusableElements.indexOf(element);
    if (index !== -1) {
      this.setFocusIndex(index);
    }
  }
}



interface Fiber {
  type?: string | Function;
  dom?: Node;
  props: {
    children: VNode[];
    [key: string]: any;
  };
  parent?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
  alternate?: Fiber;
  effectTag?: "PLACEMENT" | "UPDATE" | "DELETION";
  hooks?: Hook[];
  key?: string | number | null;
  propsCache?: Record<string, any>;
  __compareProps?: (prev: any, next: any) => boolean;
  __skipMemo?: boolean;
  _needsUpdate?: boolean;
}

export interface VNode {
  type: string | Function;
  props: {
    children: VNode[];
    [key: string]: any;
  };
  key?: string | number | null;
}

interface Hook {
  state?: any;
  queue?: any[];
  deps?: any[];
  _cleanupFn?: Function;
  memoizedValue?: any;
  current?: any;
}

/**
 * Checks if a property key is an event handler.
 * @param {string} key - The property key to check.
 * @returns {boolean} True if the key is an event handler.
 */
const isEvent = (key: string) => key.startsWith("on");

/**
 * Checks if a property key is a regular property (not children or event).
 * @param {string} key - The property key to check.
 * @returns {boolean} True if the key is a regular property.
 */
const isProperty = (key: string) => key !== "children" && !isEvent(key);

/**
 * Creates a function to check if a property has changed between objects.
 * @param {object} prev - The previous object.
 * @param {object} next - The next object.
 * @returns {function} A function that takes a key and returns true if the property changed.
 */
const isNew = (prev: object, next: object) => (key: string) => prev[key] !== next[key];

/**
 * Creates a function to check if a property was removed from an object.
 * @param {object} prev - The previous object.
 * @param {object} next - The next object.
 * @returns {function} A function that takes a key and returns true if the property was removed.
 */
const isGone = (prev: object, next: object) => (key: string) => !(key in next);

/**
 * Creates a DOM node for a fiber.
 * @param {Fiber} fiber - The fiber to create a DOM node for.
 * @returns {Node} The created DOM node.
 */
function createDom(fiber: Fiber): Node {
  let dom: Node;

  if (fiber.type === "TEXT_ELEMENT") {
    dom = document.createTextNode(fiber.props.nodeValue ?? "");
  } else {
    const isSvg = isSvgElement(fiber);
    dom = isSvg
      ? document.createElementNS("http://www.w3.org/2000/svg", fiber.type as string)
      : document.createElement(fiber.type as string);
  }

  // Assign ref if it exists
  if (fiber.props.ref) {
    fiber.props.ref.current = dom;
  }

  updateDom(dom, {}, fiber.props);
  return dom;
}

function isSvgElement(fiber: Fiber): boolean {
  // Check if the fiber is an <svg> itself or inside an <svg>
  let parent = fiber.parent;
  if (fiber.type === "svg") return true;
  while (parent) {
    if (parent.type === "svg") return true;
    parent = parent.parent;
  }
  return false;
}


/**
 * Applies updated props to a DOM node.
 * @param {Node} dom - The DOM node to update.
 * @param {object} prevProps - The previous properties.
 * @param {object} nextProps - The new properties.
 */
function updateDom(dom: Node, prevProps: any, nextProps: any): void {
  prevProps = prevProps || {};
  nextProps = nextProps || {};

  const isSvg = dom instanceof SVGElement;

  // Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(key => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      if (typeof prevProps[name] === 'function') {
        (dom as Element).removeEventListener(eventType, prevProps[name]);
      }
    });

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      if (name === 'className' || name === 'class') {
        (dom as Element).removeAttribute('class');
      } else if (name === 'style') {
        (dom as HTMLElement).style.cssText = '';
      } else {
        if (isSvg) {
          (dom as Element).removeAttribute(name);
        } else {
          (dom as any)[name] = '';
        }
      }
    });

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      if (name === 'style') {
        const style = nextProps[name];
        if (typeof style === 'string') {
          (dom as HTMLElement).style.cssText = style;
        } else if (typeof style === 'object' && style !== null) {
          for (const [key, value] of Object.entries(style)) {
            (dom as HTMLElement).style[key] = value;
          }
        }
      } else if (name === 'className' || name === 'class') {
        (dom as Element).setAttribute('class', nextProps[name]);
      } else {
        if (isSvg) {
          (dom as Element).setAttribute(name, nextProps[name]);
        } else {
          (dom as any)[name] = nextProps[name];
        }
      }
    });

  // Add new event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      const handler = nextProps[name];
      if (typeof handler === 'function') {
        (dom as Element).addEventListener(eventType, handler);
      }
    });

  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      const handler = nextProps[name];
      if (typeof handler === 'function') {
        // Remove old listener first if it exists
        if (prevProps[name]) {
          dom.removeEventListener(eventType, prevProps[name]);
        }
        // Add new listener with passive: true for better performance
        dom.addEventListener(eventType, handler, { passive: true });
      }
    });
}


/**
 * Commits the entire work-in-progress tree to the DOM.
 */
function commitRoot(): void {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
  isRenderScheduled = false;
}

/**
 * Recursively commits a fiber and its children to the DOM.
 * @param {Fiber} fiber - The fiber to commit.
 */
function commitWork(fiber: Fiber | null): void {
  if (!fiber) {
    return;
  }

  let domParentFiber = fiber.parent;
  while (domParentFiber && !domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber ? domParentFiber.dom : null;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    if (domParent) domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate?.props ?? {}, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

/**
 * Recursively removes a fiber and its children from the DOM.
 * @param {Fiber} fiber - The fiber to remove.
 */
function commitDeletion(fiber: Fiber | null): void {
  if (!fiber) {
    return;
  }
  if (fiber.dom) {
    if (fiber.dom.parentNode) {
      fiber.dom.parentNode.removeChild(fiber.dom);
    }
  } else if (fiber.child) {
    commitDeletion(fiber.child);
  }
}

/**
 * Renders a virtual DOM element into a container.
 * @param {VNode} element - The root virtual DOM element to render.
 * @param {Node} container - The DOM container to render into.
 */
export function render(element: VNode, container: Node): void {
  container.innerHTML = "";

  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
  requestAnimationFrame(workLoop);
}

/**
 * The main work loop for rendering and reconciliation.
 */
function workLoop(): void {
  if (!wipRoot && currentRoot) {
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    deletions = [];
    nextUnitOfWork = wipRoot;
  }

  while (nextUnitOfWork) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }
}


/**
 * Performs work on a single fiber unit.
 * @param {Fiber} fiber - The fiber to perform work on.
 * @returns {Fiber|null} The next fiber to work on.
 */
function performUnitOfWork(fiber: Fiber): Fiber | null {
  const isFunctionComponent = fiber.type instanceof Function;

  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  if (fiber.child) {
    return fiber.child;
  }

  let nextFiber = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
  return null;
}

/**
 * Updates a function component fiber.
 * @param {Fiber} fiber - The function component fiber to update.
 */
function updateFunctionComponent(fiber: Fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  fiber.hooks = fiber.alternate?.hooks || [];

  // Directly call the component function without memoization
  // The 'createComponent' call is removed.
  const children = [(fiber.type as Function)(fiber.props)]
    .flat()
    .filter(child => child != null && typeof child !== 'boolean')
    .map(child => typeof child === 'object' ? child : createTextElement(child));

  reconcileChildren(fiber, children);
}
/**
 * Updates a host component fiber (DOM element).
 * @param {Fiber} fiber - The host component fiber to update.
 */
function updateHostComponent(fiber: Fiber): void {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

/**
 * Reconciles the children of a fiber with new elements.
 * @param {Fiber} wipFiber - The work-in-progress fiber.
 * @param {VNode[]} elements - The new child elements.
 */
function reconcileChildren(wipFiber: Fiber, elements: VNode[]) {
  let index = 0;
  let oldFiber = wipFiber.alternate?.child;
  let prevSibling: Fiber | null = null;

  // Create map of existing fibers by key
  const existingFibers = new Map<string | number | null, Fiber>();
  while (oldFiber) {
    const key = oldFiber.key ?? index;
    existingFibers.set(key, oldFiber);
    oldFiber = oldFiber.sibling;
    index++;
  }

  index = 0;
  for (; index < elements.length; index++) {
    const element = elements[index];
    const key = element?.key ?? index;
    const oldFiber = existingFibers.get(key);

    const sameType = oldFiber && element && element.type === oldFiber.type;
    let newFiber: Fiber | null = null;

    if (sameType) {
      // Reuse the fiber
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
        hooks: oldFiber.hooks,
        key
      };
      existingFibers.delete(key);
    } else if (element) {
      // Create new fiber
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
        key
      };
    }

    if (oldFiber && !sameType) {
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (prevSibling && newFiber) {
      prevSibling.sibling = newFiber;
    }

    if (newFiber) {
      prevSibling = newFiber;
    }
  }

  // Mark remaining old fibers for deletion
  existingFibers.forEach(fiber => {
    fiber.effectTag = "DELETION";
    deletions.push(fiber);
  });
}

/**
 * Creates a virtual DOM element.
 * @param {string|Function} type - The type of the element.
 * @param {object} props - The element's properties.
 * @param {...any} children - The element's children.
 * @returns {VNode} The created virtual DOM element.
 */
export function createElement(
  type: string | Function,
  props?: object,
  ...children: any[]
): VNode {
  return {
    type,
    props: {
      ...props,
      children: children
        .flat()
        .filter(child => child != null && typeof child !== "boolean")
        .map(child =>
          typeof child === "object" ? child : createTextElement(child)
        ),
    },
    key: props?.key ?? null,
  };
}

/**
 * Creates a text virtual DOM element.
 * @param {string} text - The text content.
 * @returns {VNode} The created text element.
 */
function createTextElement(text: string): VNode {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
  };
}

/**
 * A React-like useState hook for managing component state.
 * @template T
 * @param {T|(() => T)} initial - The initial state value or initializer function.
 * @returns {[T, (action: T | ((prevState: T) => T)) => void]} A stateful value and a function to update it.
 */



export function useState<T>(initial: T | (() => T)): [T, (action: T | ((prevState: T) => T)) => void] {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }

  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = {
      state: typeof initial === "function" ? (initial as () => T)() : initial,
      queue: [],
      _needsUpdate: false
    };
    wipFiber.hooks[hookIndex] = hook;
  }

  const setState = (action: T | ((prevState: T) => T)) => {
    // Calculate new state based on current state 
    const newState = typeof action === "function"
      ? (action as (prevState: T) => T)(hook.state)
      : action;

    hook.state = newState;

    // Reset work-in-progress root to trigger re-r 

    deletions = [];
    nextUnitOfWork = wipRoot;

    // Start the render process
    requestAnimationFrame(workLoop);
  };

  hookIndex++;
  return [hook.state, setState];
}

/**
 * A React-like useEffect hook for side effects.
 * @param {Function} callback - The effect callback.
 * @param {Array} deps - The dependency array.
 */
export function useEffect(callback: Function, deps?: any[]): void {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }

  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = { deps: undefined, _cleanupFn: undefined };
    wipFiber.hooks[hookIndex] = hook;
  }

  const hasChanged = hook.deps === undefined ||
    !deps ||
    deps.some((dep, i) => !Object.is(dep, hook.deps[i]));

  if (hasChanged) {
    if (hook._cleanupFn) {
      hook._cleanupFn();
    }
    setTimeout(() => {
      const newCleanup = callback();
      if (typeof newCleanup === 'function') {
        hook._cleanupFn = newCleanup;
      } else {
        hook._cleanupFn = undefined;
      }
    }, 0);
  }

  hook.deps = deps;
  hookIndex++;
}

/**
 * A switch component for conditional rendering.
 * @param {object} props - The component props.
 * @param {VNode[]} props.children - The child components.
 * @returns {VNode|null} The matched child or null.
 */
export function Switch({ children }: { children: VNode[] }): VNode | null {
  const childrenArray = Array.isArray(children) ? children : [children];
  const match = childrenArray.find(child => child && child.props.when);
  if (match) {
    return match;
  }
  return childrenArray.find(child => child && child.props.default) || null;
}

/**
 * A match component for use with Switch.
 * @param {object} props - The component props.
 * @param {boolean} props.when - The condition to match.
 * @param {VNode[]} props.children - The child components.
 * @returns {VNode|null} The children if when is true, otherwise null.
 */
export function Match({ when, children }: { when: boolean, children: VNode[] }): VNode | null {
  //@ts-ignore
  return when ? children : null;
}

export function Show({ when, children }: { when: boolean, children: VNode[] }): VNode | null {
  //@ts-ignore
  return when ? children : null;
}
/**
 * @description Show toast allows you to invoke system level toast api to show data to user
 * @param message 
 * @param duration 
 */
export function showToast(message: string, duration = 3000) {
  if (typeof window !== "undefined" && (window as any).Android?.showToast) {
    console.log("[Vader] Android Toast");
    (window as any).Android.showToast(message);
    return;
  }

  // Web fallback
  console.log("[Toast]", message);

  const toast = document.createElement("div");
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.85)",
    color: "white",
    padding: "10px 14px",
    borderRadius: "8px",
    zIndex: 9999,
    fontSize: "14px",
  });

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

type PermissionName =
  | "storage"
  | "internet"
  | "camera"
  | "microphone"
  | "notifications";

let permissionResolver: ((granted: boolean) => void) | null = null;

export function usePermission() {
  const isAndroid =
    typeof window !== "undefined" &&
    (window as any).Android?.requestPermission;

  function request(name: PermissionName): Promise<boolean> {
    if (isAndroid) {
      return new Promise<boolean>((resolve) => {
        permissionResolver = resolve;
        (window as any).Android.requestPermission(name);
      });
    }

    // ---- Web fallback ----
    console.warn(`[Permission] ${name} auto-granted on web`);
    return Promise.resolve(true);
  }

  function has(name: PermissionName): Promise<boolean> {
    if (isAndroid && (window as any).Android.hasPermission) {
      return Promise.resolve(
        (window as any).Android.hasPermission(name)
      );
    }
    return Promise.resolve(true);
  }

  return {
    request,
    has,

    // ergonomic helpers
    storage: () => request("storage"),
    camera: () => request("camera"),
    microphone: () => request("microphone"),
    notifications: () => request("notifications"),
    internet: () => request("internet")
  };
}

export const App = {
  // Internal helper to talk to C#
  _send: function (command, payload = {}) {
    const id = Math.random().toString(36).substring(2, 9);
    const message = { id, command, ...payload };

    return new Promise((resolve, reject) => {
      // Optional: Listen for a one-time response from C#
      const handler = (event) => {
        if (event.data.id === id) {
          window.removeEventListener('message', handler);
          if (event.data.error) reject(event.data.error);
          else resolve(event.data.data);
        }
      };
      window.chrome.webview.addEventListener('message', handler);
      window.chrome.webview.postMessage(message);
    });
  },

  // Window Management
  resize: (width, height) => App._send("setWindowSize", { width, height }),
  close: () => App._send("closeApp"),

  // OS Integration
  openLink: (url) => App._send("openExternal", { url }),
  revealInExplorer: (path) => App._send("showInFolder", { path }),
  openInBrowser: function (url) {
    window.chrome.webview.postMessage({
      id: "req_" + Date.now(),
      command: "openExternal",
      url: url
    });
  }
};

type FS = {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<boolean>
  deleteFile(path: string): Promise<boolean>
  listDir(path: string): Promise<string[]>
}

// Request tracker for Windows PostMessage
const pendingRequests = new Map<string, (data: any) => void>();

// Listen for responses from Windows C#
if (typeof window !== "undefined" && window.chrome?.webview) {
  window.chrome.webview.addEventListener('message', (event: any) => {
    console.log("Received from C#:", event.data);
    const { id, data, error } = event.data;

    if (pendingRequests.has(id)) {
      if (error) {
        console.error(`C# Error for request ${id}:`, error);
        pendingRequests.get(id)!(null);
      } else {
        pendingRequests.get(id)!(data);
      }
      pendingRequests.delete(id);
    }
  });
}

/**
 * Sends a command to the Windows C# backend
 */
function callWindows(command: string, args: any): Promise<any> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).substring(2, 9);
    pendingRequests.set(id, resolve);

    const message = {
      id,
      command,
      ...args
    };

    console.log("Sending to C#:", message);
    window.chrome.webview.postMessage(message);
  });
}

/**
 * Convert absolute paths to relative paths for Windows
 * Windows C# expects paths relative to WebData directory
 */
function toRelativePath(path: string): string {
  // If it's already a relative path, return as-is
  if (!path.startsWith('/') && !/^[a-zA-Z]:/.test(path)) {
    return path;
  }

  // Extract just the filename if it's an absolute path
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1];
}

export const FS: FS = {
  async writeFile(path: string, content: string): Promise<boolean> {
    const currentPlatform = platform();

    try {
      if (currentPlatform === "windows") {
        // Use relative path for Windows
        const relativePath = toRelativePath(path);
        return await callWindows('writeFile', {
          path: relativePath,
          content
        });
      }

      if (currentPlatform === "android" && window.Android) {
        const result = window.Android.writeFile(path, content);
        return result === true || result === 'true';
      }
    } catch (error) {
      console.error('FS.writeFile error:', error);
      return false;
    }

    console.error('FS: Platform not supported or bridge missing');
    return false;
  },

  async readFile(path: string): Promise<string> {
    const currentPlatform = platform();

    try {
      if (currentPlatform === "windows") {
        // Use relative path for Windows
        const relativePath = toRelativePath(path);
        const result = await callWindows('readFile', { path: relativePath });
        return result === "FILE_NOT_FOUND" ? "" : result;
      }

      if (currentPlatform === "android" && window.Android) {
        const result = window.Android.readFile(path);
        if (typeof result === 'boolean') return result ? 'true' : 'false';
        return result || '';
      }
    } catch (error) {
      console.error('FS.readFile error:', error);
      return "";
    }

    return "";
  },

  async deleteFile(path: string): Promise<boolean> {
    const currentPlatform = platform();

    try {
      if (currentPlatform === "windows") {
        // Use relative path for Windows
        const relativePath = toRelativePath(path);
        return await callWindows('deleteFile', { path: relativePath });
      }

      if (currentPlatform === "android" && window.Android) {
        if (typeof window.Android.deleteFile === 'function') {
          const result = window.Android.deleteFile(path);
          return result === true || result === 'true';
        }
        return await this.writeFile(path, '');
      }
    } catch (error) {
      console.error('FS.deleteFile error:', error);
      return false;
    }

    return false;
  },

  async listDir(path: string = ''): Promise<string[]> {
    const currentPlatform = platform();

    try {
      if (currentPlatform === "windows") {
        // Use relative path for Windows
        const relativePath = toRelativePath(path);
        const result = await callWindows('listDir', { path: relativePath });
        return Array.isArray(result) ? result : [];
      }

      if (currentPlatform === "android" && window.Android) {
        if (typeof window.Android.listFiles === 'function') {
          const result = window.Android.listFiles(path);
          try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result;
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return result ? [result] : [];
          }
        }
      }
    } catch (error) {
      console.error('FS.listDir error:', error);
      return [];
    }

    return [];
  }
};
type DialogOptions = {
  title?: string;
  message: string;
  okText?: string;
  cancelText?: string;
};

let dialogResolver: ((value: boolean) => void) | null = null;

export function useDialog() {
  // ---- ANDROID IMPLEMENTATION ----
  if (typeof window !== "undefined" && (window as any).Android?.showDialog) {
    return {
      alert({ title = "", message, okText = "OK" }: DialogOptions) {
        return new Promise<void>((resolve) => {
          dialogResolver = () => resolve();

          (window as any).Android.showDialog(
            title,
            message,
            okText,
            "" // no cancel
          );
        });
      },

      confirm({
        title = "",
        message,
        okText = "OK",
        cancelText = "Cancel",
      }: DialogOptions) {
        return new Promise<boolean>((resolve) => {
          dialogResolver = resolve;

          (window as any).Android.showDialog(
            title,
            message,
            okText,
            cancelText
          );
        });
      },
    };
  }

  // ---- WEB FALLBACK ----
  return {
    alert({ title = "", message }: DialogOptions) {
      window.alert(title ? `${title}\n\n${message}` : message);
      return Promise.resolve();
    },

    confirm({ title = "", message }: DialogOptions) {
      const result = window.confirm(
        title ? `${title}\n\n${message}` : message
      );
      return Promise.resolve(result);
    },
  };
}


/**
 * A React-like useRef hook for mutable references.
 * @template T
 * @param {T} initial - The initial reference value.
 * @returns {{current: T}} A mutable ref object.
 */
export function useRef<T>(initial: T): { current: T } {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }

  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = { current: initial };
    wipFiber.hooks[hookIndex] = hook;
  }

  hookIndex++;
  //@ts-ignore
  return hook;
}

/**
 * A React-like useLayoutEffect hook that runs synchronously after DOM mutations.
 * @param {Function} callback - The effect callback.
 * @param {Array} deps - The dependency array.
 */
export function useLayoutEffect(callback: Function, deps?: any[]): void {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }

  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = { deps: undefined, _cleanupFn: undefined };
    wipFiber.hooks[hookIndex] = hook;
  }

  const hasChanged = hook.deps === undefined ||
    !deps ||
    deps.some((dep, i) => !Object.is(dep, hook.deps[i]));

  if (hasChanged) {
    if (hook._cleanupFn) {
      hook._cleanupFn();
    }
    const cleanup = callback();
    if (typeof cleanup === 'function') {
      hook._cleanupFn = cleanup;
    } else {
      hook._cleanupFn = undefined;
    }
  }

  hook.deps = deps;
  hookIndex++;
}

/**
 * A React-like useReducer hook for state management with reducers.
 * @template S
 * @template A
 * @param {(state: S, action: A) => S} reducer - The reducer function.
 * @param {S} initialState - The initial state.
 * @returns {[S, (action: A) => void]} The current state and dispatch function.
 */
export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialState: S
): [S, (action: A) => void] {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }

  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = {
      state: initialState,
      queue: [],
    };
    wipFiber.hooks[hookIndex] = hook;
  }

  hook.queue.forEach((action) => {
    hook.state = reducer(hook.state, action);
  });
  hook.queue = [];

  const dispatch = (action: A) => {
    hook.queue.push(action);
    if (!isRenderScheduled) {
      isRenderScheduled = true;
      requestAnimationFrame(workLoop);
    }
  };

  hookIndex++;
  return [hook.state, dispatch];
}

/**
 * A React-like useContext hook for accessing context values.
 * @template T
 * @param {Context<T>} Context - The context object to use.
 * @returns {T} The current context value.
 */
export function useContext<T>(Context: Context<T>): T {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }

  let fiber = wipFiber.parent;
  while (fiber) {
    if (fiber.type && fiber.type._context === Context) {
      return fiber.props.value;
    }
    fiber = fiber.parent;
  }

  return Context._defaultValue;
}

interface Context<T> {
  _defaultValue: T;
  Provider: Function & { _context: Context<T> };
}

/**
 * Creates a context object for use with useContext.
 * @template T
 * @param {T} defaultValue - The default context value.
 * @returns {Context<T>} The created context object.
 */
export function createContext<T>(defaultValue: T): Context<T> {
  const context = {
    _defaultValue: defaultValue,
    Provider: function Provider({ children }: { children: VNode[] }) {
      return children;
    },
  };
  context.Provider._context = context;
  return context;
}

/**
 * A React-like useMemo hook for memoizing expensive calculations.
 * @template T
 * @param {() => T} factory - The function to memoize.
 * @param {Array} deps - The dependency array.
 * @returns {T} The memoized value.
 */
export function useMemo<T>(factory: () => T, deps?: any[]): T {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }

  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = { memoizedValue: factory(), deps };
    wipFiber.hooks[hookIndex] = hook;
  }

  const hasChanged = hook.deps === undefined ||
    !deps ||
    deps.some((dep, i) => !Object.is(dep, hook.deps[i]));
  if (hasChanged) {
    hook.memoizedValue = factory();
    hook.deps = deps;
  }

  hookIndex++;
  return hook.memoizedValue;
}

/**
 * A React-like useCallback hook for memoizing functions.
 * @template T
 * @param {T} callback - The function to memoize.
 * @param {Array} deps - The dependency array.
 * @returns {T} The memoized callback.
 */
export function useCallback<T extends Function>(callback: T, deps?: any[]): T {
  return useMemo(() => callback, deps);
}

/**
 * A hook for managing arrays with common operations.
 * @template T
 * @param {T[]} initialValue - The initial array value.
 * @returns {{
 *   array: T[],
 *   add: (item: T) => void,
 *   remove: (index: number) => void,
 *   update: (index: number, item: T) => void
 * }} An object with the array and mutation functions.
 */
export function useArray<T>(initialValue: T[] = []): {
  array: T[],
  add: (item: T) => void,
  remove: (index: number) => void,
  update: (index: number, item: T) => void
} {
  const [array, setArray] = useState(initialValue);

  const add = (item: T) => {
    setArray((prevArray) => [...prevArray, item]);
  };

  const remove = (index: number) => {
    setArray((prevArray) => prevArray.filter((_, i) => i !== index));
  };

  const update = (index: number, item: T) => {
    setArray((prevArray) => prevArray.map((prevItem, i) => (i === index ? item : prevItem)));
  };

  return { array, add, remove, update };
}

/**
 * A hook for running a function at a fixed interval.
 * @param {Function} callback - The function to run.
 * @param {number|null} delay - The delay in milliseconds, or null to stop.
 */
export function useInterval(callback: Function, delay: number | null): void {
  useEffect(() => {
    if (delay === null) return;
    const interval = setInterval(callback, delay);
    return () => clearInterval(interval);
  }, [callback, delay]);
}

// Types for cache configuration
interface QueryCacheOptions {
  expiryMs?: number; // Cache duration in milliseconds
  enabled?: boolean; // Whether caching is enabled
}

// Default cache options
const DEFAULT_CACHE_OPTIONS: QueryCacheOptions = {
  expiryMs: 5 * 60 * 1000, // 5 minutes default
  enabled: true
};

// In-memory cache store
const queryCache = new Map<string, {
  data: any;
  timestamp: number;
  options: QueryCacheOptions;
}>();

export function useQuery<T>(
  url: string,
  cacheOptions: QueryCacheOptions = {} // Default to empty object
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // FIX: Destructure primitive values from cacheOptions for stable dependencies.
  const {
    enabled = DEFAULT_CACHE_OPTIONS.enabled,
    expiryMs = DEFAULT_CACHE_OPTIONS.expiryMs
  } = cacheOptions;

  // FIX: Memoize the options object so its reference is stable across renders.
  // It will only be recreated if `enabled` or `expiryMs` changes.
  const mergedCacheOptions = useMemo(() => ({
    enabled,
    expiryMs,
  }), [enabled, expiryMs]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Check cache first if enabled
      if (mergedCacheOptions.enabled) {
        const cached = queryCache.get(url);
        const now = Date.now();

        if (cached && now - cached.timestamp < mergedCacheOptions.expiryMs) {
          setData(cached.data);
          setLoading(false);
          return;
        }
      }

      // Not in cache or expired - fetch fresh data
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Update cache if enabled
      if (mergedCacheOptions.enabled) {
        queryCache.set(url, {
          data: result,
          timestamp: Date.now(),
          options: mergedCacheOptions
        });
      }

      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [url, mergedCacheOptions]); // This dependency is now stable

  useEffect(() => {
    fetchData();
  }, [fetchData]); // This dependency is now stable

  return { data, loading, error, refetch: fetchData };
}

/**
 * A hook for tracking window focus state.
 * @returns {boolean} True if the window is focused.
 */
export function useWindowFocus(): boolean {
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => {
    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return isFocused;
}

/**
 * A hook for syncing state with localStorage.
 * @template T
 * @param {string} key - The localStorage key.
 * @param {T} initialValue - The initial value.
 * @returns {[T, (value: T) => void]} The stored value and a function to update it.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error("Error saving to localStorage", error);
    }
  };

  return [storedValue, setValue];
}


export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: VNode[];
}): VNode {
  const handleClick = (e: MouseEvent) => {
    e.preventDefault();

    // Normalize path
    const normalized = to.startsWith("/") ? to : "/" + to;

    // ✅ Android WebView bridge (optional)
    if (window.Android && typeof window.Android.navigate === "function") {
      window.Android.navigate(normalized);
      return;
    }

    // ✅ Android asset WebView fallback
    if (location.protocol === "file:") {
      location.href = normalized + "/index.html";
      return;
    }

    // ✅ Normal browser navigation
    window.location.href = normalized;
  };

  return createElement(
    "a",
    {
      href: to,
      onClick: handleClick,
      className,
    },
    ...children
  );
}

/**
 * A hook for detecting clicks outside an element.
 * @param {React.RefObject} ref - A ref to the element to watch.
 * @param {Function} handler - The handler to call when a click outside occurs.
 */
export function useOnClickOutside(ref: { current: HTMLElement | null }, handler: Function): void {
  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler(event);
      }
    };
    document.addEventListener("mousedown", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
    };
  }, [ref, handler]);
}

export function platform(): "windows" | "android" | "web" {
  // 1. Check for Windows WebView2 (CoreWebView2)
  // This is the most reliable way to detect the WinUI 3 bridge
  if (typeof window !== "undefined" && window.chrome && window.chrome.webview) {
    return "windows";
  }

  // 2. Check for Android User Agent
  if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) {
    return "android";
  }

  // 3. Fallback to web
  return "web";
}
/**
 * Creates a Vader.js component with automatic prop memoization.
 * @template P - Component props type 
 * @param {(props: P) => VNode} renderFn - The component render function
 * @returns {(props: P) => VNode} A memoized component function
 */
export function component<P extends object>( renderFn: (props: P) => VNode): (props: P) => VNode {
  // Create a wrapper function that will be the actual component
  const ComponentWrapper = (props: P): VNode => {
    // Check if props have changed
    let fiber = wipFiber;
    while (fiber && fiber.type !== ComponentWrapper) {
      fiber = fiber.alternate;
    }
    
    const prevProps = fiber?.alternate?.props || {};
    const nextProps = props;
    
    // Create a simple props comparison
    // For now, we'll do a shallow comparison of props
    let shouldUpdate = false;
    
    // Check if props count changed
    const prevKeys = Object.keys(prevProps);
    const nextKeys = Object.keys(nextProps);
    
    if (prevKeys.length !== nextKeys.length) {
      shouldUpdate = true;
    } else {
      // Check each prop
      for (const key of nextKeys) {
        if (nextProps[key] !== prevProps[key]) {
          shouldUpdate = true;
          break;
        }
      }
    }
    
    // Mark fiber for memoization
    const currentFiber = wipFiber;
    if (currentFiber) {
      currentFiber.propsCache = nextProps;
      currentFiber.__compareProps = (prev: P, next: P) => {
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        
        if (prevKeys.length !== nextKeys.length) return false;
        
        for (const key of nextKeys) {
          if (next[key] !== prev[key]) return false;
        }
        
        return true;
      };
      
      currentFiber.__skipMemo = !shouldUpdate;
    }
    
    // If props haven't changed, return the previous fiber's children
    if (!shouldUpdate && fiber?.alternate?.child) {
      return fiber.alternate.child.props.children[0];
    }
    
    // Otherwise render with new props
    return renderFn(props);
  };
  
  // Set display name for debugging
  (ComponentWrapper as any).displayName = name;
  
  return ComponentWrapper;
}
const Vader = {
  render,
  createElement,
  useState,
  useEffect,
  useLayoutEffect,
  useReducer,
  useContext,
  createContext,
  useMemo,
  useCallback,
  useRef,
  useArray,
  useQuery,
  useWindowFocus,
  useLocalStorage,
  useInterval,
  Switch,
  Match,
  Show,
  Link,
  showToast,
  platform,
  component,
  App
};

Object.defineProperty(window, "Vader", {
  value: Vader,
  writable: false,
  configurable: false,
});
