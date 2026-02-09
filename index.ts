; (window as any).onNativeDialogResult = function (confirmed: boolean) {
  if (dialogResolver) {
    dialogResolver(confirmed);
    dialogResolver = null;
  }
};
window.nativeHttpCallbacks = {};

window.nativeHttpResponse = (response) => {
  const callback = window.nativeHttpCallbacks[response.id];
  if (callback) {
    callback(response);
    delete window.nativeHttpCallbacks[response.id]; // Only delete the specific ID
  }
};

// Add these near the top of your file (after imports)
let isDev = false;
let globalErrorHandler: ((error: Error, componentStack?: string) => void) | null = null;

// Enable dev mode automatically in web environment
if (typeof window !== 'undefined') {
  // Check for dev mode (you could also check URL or localStorage)
  isDev = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'http:';
}

// Error Boundary Component
// Error Boundary Component - FIXED VERSION
export function ErrorBoundary({
  children,
  fallback,
  onError
}: {
  children: VNode | VNode[];
  fallback?: (error: Error, reset: () => void) => VNode;
  onError?: (error: Error, errorInfo: { componentStack: string }) => void;
}): VNode | null {
  // We need to use try-catch because hooks can also throw errors
  try {
    // Move the hook calls into a separate component
    return ErrorBoundaryInner({ children, fallback, onError });
  } catch (error) {
    // If hooks fail, render a simple fallback
    const errorObj = error instanceof Error ? error : new Error(String(error));
    if (fallback) {
      return fallback(errorObj, () => window.location.reload());
    }

    return createElement(
      "div",
      {
        style: {
          padding: '20px',
          backgroundColor: '#f8d7da',
          color: '#721c24',
          border: '1px solid #f5c6cb',
          borderRadius: '5px'
        }
      },
      createElement("h3", {}, "Error Boundary Failed"),
      createElement("pre", { style: { whiteSpace: 'pre-wrap' } }, errorObj.toString())
    );
  }
}

// Inner component that uses hooks
function ErrorBoundaryInner({
  children,
  fallback,
  onError
}: {
  children: VNode | VNode[];
  fallback?: (error: Error, reset: () => void) => VNode;
  onError?: (error: Error, errorInfo: { componentStack: string }) => void;
}): VNode | null {
  const [error, setError] = useState<Error | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ componentStack: string } | null>(null);

  const resetError = () => {
    setError(null);
    setErrorInfo(null);
  };

  useEffect(() => {
    // Handle errors from children components
    const handleError = (err: Error, componentStack?: string) => {
      setError(err);
      if (componentStack) {
        setErrorInfo({ componentStack });
      }
      if (onError) {
        onError(err, { componentStack: componentStack || '' });
      }
    };

    // Store the previous handler
    const previousHandler = globalErrorHandler;
    globalErrorHandler = handleError;

    // Also catch unhandled errors and promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      handleError(event.reason, 'Unhandled Promise Rejection');
    };

    const handleUncaughtError = (event: ErrorEvent) => {
      handleError(event.error, 'Uncaught Error');
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleUncaughtError);

    return () => {
      globalErrorHandler = previousHandler;
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleUncaughtError);
    };
  }, [onError]);

  if (error) {
    if (fallback) {
      return fallback(error, resetError);
    }

    return createElement(
      "div",
      {
        style: {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#1a1a1a',
          color: '#fff',
          padding: '20px',
          fontFamily: 'monospace',
          overflow: 'auto',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column'
        }
      },
      createElement("h1", {
        style: {
          color: '#ff6b6b',
          marginBottom: '20px',
          fontSize: '24px'
        }
      }, "⚠️ Application Error"),

      createElement("div", {
        style: {
          backgroundColor: '#2a2a2a',
          padding: '15px',
          borderRadius: '5px',
          marginBottom: '10px',
          overflow: 'auto'
        }
      },
        createElement("pre", { style: { margin: 0, whiteSpace: 'pre-wrap' } },
          error.toString() + (error.stack ? '\n\nStack trace:\n' + error.stack : '')
        )
      ),

      errorInfo && createElement("div", {
        style: {
          backgroundColor: '#2a2a2a',
          padding: '15px',
          borderRadius: '5px',
          marginBottom: '10px',
          overflow: 'auto'
        }
      },
        createElement("pre", { style: { margin: 0, whiteSpace: 'pre-wrap', fontSize: '12px' } },
          "Component stack:\n" + errorInfo.componentStack
        )
      ),

      createElement("div", { style: { display: 'flex', gap: '10px', marginTop: '20px' } },
        createElement("button", {
          style: {
            backgroundColor: '#ff6b6b',
            color: 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px'
          },
          onClick: () => {
            resetError();
            // Force re-render of the app
            if (currentRoot) {
              wipRoot = {
                dom: currentRoot.dom,
                props: currentRoot.props,
                alternate: currentRoot,
              };
              deletions = [];
              nextUnitOfWork = wipRoot;
              requestIdleCallback(workLoop);
            }
          }
        }, "Try Again"),

        isDev && createElement("button", {
          style: {
            backgroundColor: '#4a90e2',
            color: 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '14px'
          },
          onClick: () => {
            // Copy error to clipboard
            const errorText = error.toString() + (error.stack ? '\n\n' + error.stack : '') +
              (errorInfo ? '\n\nComponent stack:\n' + errorInfo.componentStack : '');
            navigator.clipboard.writeText(errorText).then(() => {
              showToast('Error copied to clipboard', 2000);
            });
          }
        }, "Copy Error")
      )
    );
  }

  return children as VNode;
}

// Hook for error boundaries
export function useErrorBoundary(): {
  error: Error | null;
  resetError: () => void;
} {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (globalErrorHandler) {
      const originalHandler = globalErrorHandler;
      globalErrorHandler = (error: Error) => {
        setError(error);
        originalHandler(error);
      };
      return () => {
        globalErrorHandler = originalHandler;
      };
    }
  }, []);

  const resetError = () => setError(null);

  return { error, resetError };
}

// Error reporting function
export function reportError(error: Error, componentStack?: string) {
  if (isDev) {
    console.error('[VaderJS Error]', error);
    if (componentStack) {
      console.error('[VaderJS Component Stack]', componentStack);
    }

    // Display error in UI for Android/Windows where console might not be visible
    if (platform() !== 'web') {
      if (globalErrorHandler) {
        globalErrorHandler(error, componentStack);
      } else {
        // Fallback: Show toast
        showToast(`Error: ${error.message}`, 5000);
      }
    }
  } else {
    // In production, you might want to log errors to a service
    console.error(error);
  }
}

// Wrap the render function with error handling
export function renderWithErrorBoundary(element: VNode, container: Node) {
  const wrappedElement = createElement(ErrorBoundary, {
    fallback: (error: Error, reset: () => void) => {
      return createElement(
        "div",
        {
          style: {
            padding: '20px',
            backgroundColor: '#f8d7da',
            color: '#721c24',
            border: '1px solid #f5c6cb',
            borderRadius: '5px',
            margin: '20px'
          }
        },
        createElement("h3", { style: { marginTop: 0 } }, "App Error"),
        createElement("pre", {
          style: {
            backgroundColor: '#f5f5f5',
            padding: '10px',
            borderRadius: '3px',
            overflow: 'auto'
          }
        }, error.toString()),
        createElement("button", {
          onClick: reset,
          style: {
            backgroundColor: '#721c24',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '3px',
            cursor: 'pointer',
            marginTop: '10px'
          }
        }, "Reload App")
      );
    }
  }, element);

  render(wrappedElement, container);
}
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
export function navigate(path) {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
/**
 * Native HTTP function for making HTTP requests via the native layer.
 * @param options 
 * @returns  Promise<{status: number, body: any}>
 */
export async function nativeHttp(options: {
  url: string,
  method?: string,
  headers?: Record<string, string>,
  body?: any
}): Promise<{ status: number, body: any }> {
  const id = Math.random().toString(36).substring(2);
  const platformName = platform(); // "android", "windows", "web"

  return new Promise<any>((resolve, reject) => {
    if (platformName === "android" && window.Android) {

      // 2. Register this specific request's resolver
      window.nativeHttpCallbacks[id] = (response) => {
        if (response.success) {
          let parsedBody = response.body;
          try { parsedBody = JSON.parse(response.body); } catch { }
          resolve({ status: response.status, body: parsedBody });
        } else {
          reject(new Error(response.error || "HTTP Request Failed"));
        }
      };

      const request = {
        id,
        url: options.url,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        body: options.body ? JSON.stringify(options.body) : null
      };

      window.Android.nativeHttp(JSON.stringify(request));
      return;
    }

    if (platformName === "windows" && isWebView) {
      function handler(event: any) {
        const data = event.data;
        if (data.id === id) {
          window.chrome.webview.removeEventListener("message", handler);
          data.data.body = JSON.parse(data.data.body);
          if (data.error) reject(new Error(data.error));
          else resolve(data.data);
        }
      }
      window.chrome.webview.addEventListener("message", handler);

      window.chrome.webview.postMessage({
        command: "http",
        id,
        url: options.url,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
        body: options.body ?? null
      });
      return;
    }

    // Web fallback
    fetch(options.url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    })
      .then(async res => {
        const contentType = res.headers.get("Content-Type") || "";
        const body = contentType.includes("application/json") ? await res.json() : await res.text();
        resolve({ status: res.status, body });
      })
      .catch(reject);
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



interface Fiber {
  type?: string | Function;
  dom?: Node;
  props: {
    children: VNode[];
    [key: string]: any;
    ref?: { current: any };
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
    ref?: { current: any };
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

  // Initialize ref to null first
  if (fiber.props.ref) {
    fiber.props.ref.current = null;
  }

  updateDom(dom, {}, fiber.props);
  
  // Now assign the DOM element to ref
  if (fiber.props.ref) {
    fiber.props.ref.current = dom;
  }

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

const isWebView =
  typeof window !== "undefined" &&
  window.chrome &&
  window.chrome.webview &&
  typeof window.chrome.webview.postMessage === "function";

/* ─────────────────────────────── */
/* WebView2 implementation */
/* ─────────────────────────────── */

function createWebViewSecureStore() {
  return {
    async sendCommand(subcommand, key, value) {
      return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);

        function handler(event) {
          const data = event.data;
          if (data?.id === id) {
            window.chrome.webview.removeEventListener("message", handler);
            if (data.error) {
              reject(new Error(data.error))
            } else {
              try {
                resolve(JSON.parse(data.data));
              } catch {
                resolve(data.data); // plain string fallback
              }
            }


          }
        }

        window.chrome.webview.addEventListener("message", handler);

        const payload = { command: "secureStore", id, subcommand };
        if (key !== undefined) payload.key = key;
        if (value !== undefined) payload.value = value;

        window.chrome.webview.postMessage(payload);
      });
    },

    set(key, value) {
      return this.sendCommand("set", key, value);
    },

    get(key) {
      return this.sendCommand("get", key);
    },

    delete(key) {
      return this.sendCommand("delete", key);
    },

    clear() {
      return this.sendCommand("clear");
    },

    getAll() {
      return this.sendCommand("getAll");
    },

    isAvailable() {
      return this.sendCommand("isAvailable");
    }
  };
}

/* ─────────────────────────────── */
/* Browser fallback polyfill */
/* ─────────────────────────────── */

function createBrowserSecureStore() {
  const prefix = "__vader_secure__";
  console.warn(`[Vader.js] Warning: Using browser localStorage as a fallback for secure storage. This is not secure and should only be used for development purposes. should
    you need security, please handle any sensitive data on the backend `);

  return {
    async set(key, value) {
      localStorage.setItem(prefix + key, JSON.stringify(value));
      return true;
    },

    async get(key) {
      const raw = localStorage.getItem(prefix + key);
      return raw ? JSON.parse(raw) : null;
    },

    async delete(key) {
      localStorage.removeItem(prefix + key);
      return true;
    },

    async clear() {
      Object.keys(localStorage)
        .filter(k => k.startsWith(prefix))
        .forEach(k => localStorage.removeItem(k));
      return true;
    },

    async getAll() {
      const out = {};
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(prefix)) {
          out[key.replace(prefix, "")] = JSON.parse(localStorage.getItem(key));
        }
      }
      return out;
    },

    async isAvailable() {
      return true;
    }
  };
}

/* ─────────────────────────────── */
/* Public export */
/* ─────────────────────────────── */

function createAndroidSecureStore() {
  return {
    async set(key: string, value: any) {
      try {
        const result = window.Android.secureStoreSet(key, JSON.stringify(value));
        return result === true || result === "true";
      } catch (err) {
        console.error("Android secureStore set error:", err);
        return false;
      }
    },
    async get(key: string) {
      try {
        const result = window.Android.secureStoreGet(key);
        return result ? JSON.parse(result) : null;
      } catch (err) {
        console.error("Android secureStore get error:", err);
        return null;
      }
    },
    async delete(key: string) {
      try {
        const result = window.Android.secureStoreDelete(key);
        return result === true || result === "true";
      } catch (err) {
        console.error("Android secureStore delete error:", err);
        return false;
      }
    },
    async clear() {
      try {
        const result = window.Android.secureStoreClear();
        return result === true || result === "true";
      } catch (err) {
        console.error("Android secureStore clear error:", err);
        return false;
      }
    },
    async getAll() {
      try {
        const result = window.Android.secureStoreGetAll();
        return result ? JSON.parse(result) : {};
      } catch (err) {
        console.error("Android secureStore getAll error:", err);
        return {};
      }
    },
    async isAvailable() {
      return typeof window.Android?.secureStoreSet === "function";
    }
  };
}

// Final export
export const secureStore = (() => {
  if (typeof window !== "undefined") {
    if (platform() === "android" && window.Android?.secureStoreSet) {
      return createAndroidSecureStore();
    }
    if (isWebView) return createWebViewSecureStore();
    return createBrowserSecureStore();
  }
  return createBrowserSecureStore();
})();

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

  // Handle ref changes
  if (prevProps.ref !== nextProps.ref) {
    // Clear old ref
    if (prevProps.ref) {
      prevProps.ref.current = null;
    }
    // Set new ref
    if (nextProps.ref) {
      nextProps.ref.current = dom;
    }
  }

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
      } else if (name === 'ref') {
        // Already handled above
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
      } else if (name === 'ref') {
        // Already handled above
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
    // Ref already set in createDom
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
  if (!fiber) return;
  
  // Only clear ref if this is an actual deletion (not just an update)
  if (fiber.effectTag === "DELETION" && fiber.props?.ref) {
    fiber.props.ref.current = null;
  }
  
  if (fiber.dom) {
    if (fiber.dom.parentNode) {
      fiber.dom.parentNode.removeChild(fiber.dom);
    }
  } else if (fiber.child) {
    commitDeletion(fiber.child);
  }
}

var framesProcessed = 0;
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
      children: [element], // Remove ErrorBoundary wrapper for now to debug
    },
    alternate: currentRoot,
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
   
  
  // Force immediate start with requestAnimationFrame first,
  // then continue with requestIdleCallback
  requestAnimationFrame(() => {  
    const startTime = performance.now();
    
    while (nextUnitOfWork && framesProcessed < 10 && performance.now() - startTime < 8) {
      nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
      framesProcessed++;
    } 
    
    if (!nextUnitOfWork && wipRoot) {
      commitRoot(); 
    }
    
    // Continue with requestIdleCallback
    if (nextUnitOfWork || wipRoot) { 
      requestIdleCallback(workLoop, { timeout: 100 });
    }
  });
}


/**
 * The main work loop for rendering and reconciliation.
 */
 let isRendering = false;
let renderScheduled = false;

function scheduleRender() {
  if (isRendering || renderScheduled) return;
  
  renderScheduled = true;
  
  // Try requestIdleCallback first
  if ('requestIdleCallback' in window) {
    requestIdleCallback((deadline) => {
      renderScheduled = false;
      isRendering = true;
      workLoop(deadline);
      isRendering = false;
    }, { timeout: 100 }); // Timeout ensures it runs even if idle time never comes
  } else {
    // Fallback to requestAnimationFrame
    requestAnimationFrame(() => {
      renderScheduled = false;
      isRendering = true;
      workLoop();
      isRendering = false;
    });
  }
}

function workLoop(deadline?: IdleDeadline): void {
  // Process units of work
  while (nextUnitOfWork && (!deadline || deadline.timeRemaining() > 1)) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }
  
  // If we finished all work, commit to DOM
  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }
  
  // If there's still work to do, schedule more
  if (nextUnitOfWork || wipRoot) {
    // Use a hybrid approach: requestIdleCallback with fallback
    if (deadline) {
      // We came from requestIdleCallback, use it again
      requestIdleCallback(workLoop);
    } else {
      // We came from elsewhere, start with requestIdleCallback
      requestIdleCallback(workLoop);
    }
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
function getComponentStack(fiber: Fiber): string {
  const stack: string[] = [];
  let currentFiber: Fiber | null = fiber;

  while (currentFiber) {
    if (currentFiber.type) {
      const name = typeof currentFiber.type === 'function'
        ? currentFiber.type.name || 'AnonymousComponent'
        : String(currentFiber.type);
      stack.push(name);
    }
    currentFiber = currentFiber.parent;
  }

  return stack.reverse().join(' → ');
}
export const DevTools = {
  enable: () => {
    isDev = true;
    localStorage.setItem('vader-dev-mode', 'true');
    console.log('[VaderJS] Dev mode enabled');
  },

  disable: () => {
    isDev = false;
    localStorage.removeItem('vader-dev-mode');
    console.log('[VaderJS] Dev mode disabled');
  },

  isEnabled: () => isDev,

  // Force error for testing
  throwTestError: (message = 'Test error from DevTools') => {
    throw new Error(message);
  },

  // Get component tree
  getComponentTree: () => {
    const tree: any[] = [];
    let fiber: Fiber | null = currentRoot;

    function traverse(fiber: Fiber | null, depth = 0) {
      if (!fiber) return;

      tree.push({
        depth,
        type: typeof fiber.type === 'function' ? fiber.type.name : fiber.type,
        props: fiber.props,
        key: fiber.key
      });

      traverse(fiber.child, depth + 1);
      traverse(fiber.sibling, depth);
    }

    traverse(fiber);
    return tree;
  }
};
/**
 * Updates a function component fiber.
 * @param {Fiber} fiber - The function component fiber to update.
 */
function updateFunctionComponent(fiber: Fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  fiber.hooks = fiber.alternate?.hooks || [];

  let children;
  try {
    // Track component stack for better error reporting
    const componentStack = getComponentStack(fiber);

    // Wrap component execution with error boundary
    if (isDev) {
      children = [(fiber.type as Function)(fiber.props)]
        .flat()
        .filter(child => child != null && typeof child !== 'boolean')
        .map(child => typeof child === 'object' ? child : createTextElement(child));
    } else {
      children = [(fiber.type as Function)(fiber.props)]
        .flat()
        .filter(child => child != null && typeof child !== 'boolean')
        .map(child => typeof child === 'object' ? child : createTextElement(child));
    }
  } catch (error) {
    // Handle error in component
    const componentStack = getComponentStack(fiber);
    reportError(error as Error, componentStack);

    // Return error boundary or fallback UI
    children = [createElement(
      "div",
      {
        style: {
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          color: '#856404',
          padding: '10px',
          margin: '5px',
          borderRadius: '4px',
          fontSize: '14px'
        }
      },
      `Component Error: ${(error as Error).message}`
    )];
  }

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

  // 1. Map existing fibers by key for O(1) lookup
  const existingFibers = new Map<string | number | null, Fiber>();
  let tempOld = oldFiber;
  let i = 0;
  while (tempOld) {
    const key = tempOld.key ?? i;
    existingFibers.set(key, tempOld);
    tempOld = tempOld.sibling;
    i++;
  }

  // 2. Iterate through new elements
  for (index = 0; index < elements.length; index++) {
    const element = elements[index];
    const key = element?.key ?? index;
    const matchedOldFiber = existingFibers.get(key);

    const sameType = matchedOldFiber && element && element.type === matchedOldFiber.type;

    let newFiber: Fiber | null = null;

    if (sameType) {
      newFiber = {
        type: matchedOldFiber!.type,
        props: element.props,
        dom: matchedOldFiber!.dom,
        parent: wipFiber,
        alternate: matchedOldFiber!,
        effectTag: "UPDATE",
        key: key,
      };
      existingFibers.delete(key);
    } else if (element) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: undefined,
        parent: wipFiber,
        alternate: undefined,
        effectTag: "PLACEMENT",
        key: key,
      };
    }

    if (index === 0) {
      wipFiber.child = newFiber!;
    } else if (element) {
      prevSibling!.sibling = newFiber!;
    }

    if (newFiber) {
      prevSibling = newFiber;
    }
  }

  // 3. Any fibers remaining in the map were not matched and must be deleted
  existingFibers.forEach(fiber => {
    fiber.effectTag = "DELETION";
    deletions!.push(fiber);
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
    };
    wipFiber.hooks[hookIndex] = hook;
  }

  const setState = (action: T | ((prevState: T) => T)) => {
    const newState = typeof action === "function"
      ? (action as (prevState: T) => T)(hook.state)
      : action;

    hook.state = newState;

    // Schedule a re-render
    if (currentRoot) {
      wipRoot = {
        dom: currentRoot.dom,
        props: currentRoot.props,
        alternate: currentRoot,
      };
      deletions = [];
      nextUnitOfWork = wipRoot;
      
      if (typeof scheduleRender === 'function') {
        scheduleRender();
      } else {
        // Fallback
        requestAnimationFrame(workLoop);
      }
    }
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
 * @param props.children - The child components (single or multiple).
 * @returns The matched child or null.
 */
export function Switch({ children }: { children?: VNode | VNode[] }): VNode | null {
  if (!children) return null;
  const childrenArray = Array.isArray(children) ? children : [children];
  const match = childrenArray.find(child => child && child.props?.when);
  if (match) return match;
  return childrenArray.find(child => child && child.props?.default) || null;
}





/**
 * A match component for use with Switch.
 * @param props.when - The condition to match.
 * @param props.children - The child components (single or multiple).
 * @returns The children if when is true, otherwise null.
 */
export function Match({ when, children }: { when: boolean; children?: VNode | VNode[] }): VNode | null {
  if (!when || !children) return null;
  const childrenArray = Array.isArray(children) ? children : [children];
  return childrenArray.length === 1 ? childrenArray[0] : (childrenArray as unknown as VNode);
}


/**
 * A show component for conditional rendering.
 * @param props.when - Whether to show the children.
 * @param props.children - The child components (single or multiple).
 * @returns The children if when is true, otherwise null.
 */
export function Show({ when, children }: { when: boolean; children?: VNode | VNode[] }): VNode | null {
  if (!when || !children) return null;
  const childrenArray = Array.isArray(children) ? children : [children];
  return childrenArray.length === 1 ? childrenArray[0] : (childrenArray as unknown as VNode);
}

/**
 * @description Show toast allows you to invoke system level toast api to show data to user
 * @param message 
 * @param duration 
 */
export function showToast(message: string, duration = 3000) {
  if (typeof window !== "undefined" && (window as any).Android?.showToast) { 
    (window as any).Android.showToast(message);
    return;
  }
 

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
      } else {
        // write to localStorage as fallback
        localStorage.setItem(path, content);
        return true;
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

        if (typeof result === 'string') {
          try {
            const parsed = JSON.parse(result);
            // If the native side returned an error object, treat it as a failure
            if (parsed && parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (e: any) {
            // If it's the Error we just threw, rethrow it to the caller
            if (e.message === "File not found") throw e;
            // Otherwise, it was just normal file content that wasn't JSON, 
            // which is fine, so we let it fall through to return result.
          }
        }
        return result || '';
      }
    } catch (error) {
      throw error;
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
      } else {
        localStorage.removeItem(path);
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
      } else {
        const keys = Object.keys(localStorage);
        return keys;
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
/**
 * Use dialog hook for showing alert and confirm dialogs.
 * @returns  {object} An object with alert and confirm methods.
 */
export function useDialog() {
  // ---- ANDROID IMPLEMENTATION ----
  if (typeof window !== "undefined" && (window as any).Android?.showDialog) {
    return {
      /**
       *  Show an alert dialog
       * @param  options 
       * @returns 
       */
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

      /**
       *  Show a confirm dialog
       * @param  options
       * @returns 
       */
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
  return hook as { current: T };
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
if (platform() === "windows") {
  const block = (method: string) => {
    return function () {
      throw new Error(
        `[Vader.js] localStorage.${method} is not supported on Windows. Use the FS API instead.`
      );
    };
  };

  localStorage.setItem = block("setItem") as any;
  localStorage.getItem = block("getItem") as any;
  localStorage.removeItem = block("removeItem") as any;
  localStorage.clear = block("clear") as any;
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

type ForChildren<T> =
  | ((item: T, index: number) => VNode | VNode[] | null)
  | VNode
  | VNode[]
  | null;

type RenderFn<T> = (item: T, index: number) => VNode | VNode[] | null;


export function For<T>(props: {
  each?: readonly T[] | null;
  children?: RenderFn<T> | RenderFn<T>[];
}): VNode | null {
  const list = props.each;
  if (!list || list.length === 0) return null;

  // Extract the render function from children
  // In JSX, children is passed as a prop, not as arguments to createElement
  let renderFn: RenderFn<T> | null = null;

  if (props.children) {
    if (Array.isArray(props.children)) {
      // Find the first function in children array
      for (const child of props.children) {
        if (typeof child === "function") {
          renderFn = child as RenderFn<T>;
          break;
        }
      }
    } else if (typeof props.children === "function") {
      renderFn = props.children;
    }
  }

  if (!renderFn) {
    console.warn("For component requires a function as children");
    return null;
  }

  // Execute the render function for each item
  const renderedItems: (VNode | VNode[] | null)[] = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    try {
      const result = renderFn(item, i);
      if (result !== null && result !== undefined) {
        renderedItems.push(result);
      }
    } catch (error) {
      console.error("Error rendering item in For loop:", error);
    }
  }

  // Flatten the results (renderFn might return arrays)
  const flatItems: VNode[] = [];
  for (const item of renderedItems) {
    if (Array.isArray(item)) {
      for (const subItem of item) {
        if (subItem !== null && subItem !== undefined) {
          flatItems.push(subItem);
        }
      }
    } else if (item !== null && item !== undefined) {
      flatItems.push(item);
    }
  }

  if (flatItems.length === 0) return null;

  // Return a fragment containing all rendered items
  return {
    type: "fragment",
    props: {
      children: flatItems
    }
  } as VNode;
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
export function component<P extends object>(renderFn: (props: P) => VNode): (props: P) => VNode {
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
export function Fragment({ children }: { children: VNode | VNode[] }): VNode | null {
  // If children is an array, return them as-is
  // If single child, return it
  if (Array.isArray(children)) return children;
  return children;
}
const Vader = {
  render,
  renderWithErrorBoundary, // Add this new method
  Fragment,
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
  navigate,
  nativeHttp,
  For,
  App,
  ErrorBoundary,
  useErrorBoundary,
  reportError,
  DevTools
};

Object.defineProperty(window, "Vader", {
  value: Vader,
  writable: false,
  configurable: false,
});

