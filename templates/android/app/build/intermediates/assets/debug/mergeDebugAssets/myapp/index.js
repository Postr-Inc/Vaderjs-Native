var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};

// node_modules/vaderjs-native/index.ts
var exports_vaderjs_native = {};
__export(exports_vaderjs_native, {
  useWindowFocus: () => useWindowFocus,
  useState: () => useState,
  useRef: () => useRef,
  useReducer: () => useReducer,
  useQuery: () => useQuery,
  useOnClickOutside: () => useOnClickOutside,
  useMemo: () => useMemo,
  useLocalStorage: () => useLocalStorage,
  useLayoutEffect: () => useLayoutEffect,
  useInterval: () => useInterval,
  useEffect: () => useEffect,
  useContext: () => useContext,
  useCallback: () => useCallback,
  useArray: () => useArray,
  showToast: () => showToast,
  render: () => render,
  createElement: () => createElement,
  createContext: () => createContext,
  Switch: () => Switch,
  Show: () => Show,
  Match: () => Match,
  Link: () => Link
});
var ANDROID_KEY_MAP = {
  19: "ArrowUp",
  20: "ArrowDown",
  21: "ArrowLeft",
  22: "ArrowRight",
  23: "Enter",
  4: "Back"
};
window.onNativeKey = function(keyCode) {
  const key = ANDROID_KEY_MAP[keyCode];
  if (!key)
    return;
  const debugElement = document.getElementById("debug-keypress");
  if (debugElement) {
    debugElement.textContent = `Key pressed: ${key}`;
  }
  const event = new KeyboardEvent("keydown", { key });
  document.dispatchEvent(event);
};
var nextUnitOfWork = null;
var wipRoot = null;
var currentRoot = null;
var deletions = null;
var wipFiber = null;
var hookIndex = 0;
var isRenderScheduled = false;
var isEvent = (key) => key.startsWith("on");
var isProperty = (key) => key !== "children" && !isEvent(key);
var isNew = (prev, next) => (key) => prev[key] !== next[key];
var isGone = (prev, next) => (key) => !(key in next);
function createDom(fiber) {
  let dom;
  if (fiber.type === "TEXT_ELEMENT") {
    dom = document.createTextNode(fiber.props.nodeValue ?? "");
  } else {
    const isSvg = isSvgElement(fiber);
    dom = isSvg ? document.createElementNS("http://www.w3.org/2000/svg", fiber.type) : document.createElement(fiber.type);
  }
  if (fiber.props.ref) {
    fiber.props.ref.current = dom;
  }
  updateDom(dom, {}, fiber.props);
  return dom;
}
function isSvgElement(fiber) {
  let parent = fiber.parent;
  if (fiber.type === "svg")
    return true;
  while (parent) {
    if (parent.type === "svg")
      return true;
    parent = parent.parent;
  }
  return false;
}
function updateDom(dom, prevProps, nextProps) {
  prevProps = prevProps || {};
  nextProps = nextProps || {};
  const isSvg = dom instanceof SVGElement;
  Object.keys(prevProps).filter(isEvent).filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key)).forEach((name) => {
    const eventType = name.toLowerCase().substring(2);
    if (typeof prevProps[name] === "function") {
      dom.removeEventListener(eventType, prevProps[name]);
    }
  });
  Object.keys(prevProps).filter(isProperty).filter(isGone(prevProps, nextProps)).forEach((name) => {
    if (name === "className" || name === "class") {
      dom.removeAttribute("class");
    } else if (name === "style") {
      dom.style.cssText = "";
    } else {
      if (isSvg) {
        dom.removeAttribute(name);
      } else {
        dom[name] = "";
      }
    }
  });
  Object.keys(nextProps).filter(isProperty).filter(isNew(prevProps, nextProps)).forEach((name) => {
    if (name === "style") {
      const style = nextProps[name];
      if (typeof style === "string") {
        dom.style.cssText = style;
      } else if (typeof style === "object" && style !== null) {
        for (const [key, value] of Object.entries(style)) {
          dom.style[key] = value;
        }
      }
    } else if (name === "className" || name === "class") {
      dom.setAttribute("class", nextProps[name]);
    } else {
      if (isSvg) {
        dom.setAttribute(name, nextProps[name]);
      } else {
        dom[name] = nextProps[name];
      }
    }
  });
  Object.keys(nextProps).filter(isEvent).filter(isNew(prevProps, nextProps)).forEach((name) => {
    const eventType = name.toLowerCase().substring(2);
    const handler = nextProps[name];
    if (typeof handler === "function") {
      dom.addEventListener(eventType, handler);
    }
  });
  Object.keys(nextProps).filter(isEvent).filter(isNew(prevProps, nextProps)).forEach((name) => {
    const eventType = name.toLowerCase().substring(2);
    const handler = nextProps[name];
    if (typeof handler === "function") {
      if (prevProps[name]) {
        dom.removeEventListener(eventType, prevProps[name]);
      }
      dom.addEventListener(eventType, handler, { passive: true });
    }
  });
}
function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
  isRenderScheduled = false;
}
function commitWork(fiber) {
  if (!fiber) {
    return;
  }
  let domParentFiber = fiber.parent;
  while (domParentFiber && !domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber ? domParentFiber.dom : null;
  if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
    if (domParent)
      domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
    updateDom(fiber.dom, fiber.alternate?.props ?? {}, fiber.props);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber);
  }
  commitWork(fiber.child);
  commitWork(fiber.sibling);
}
function commitDeletion(fiber) {
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
function render(element, container) {
  container.innerHTML = "";
  wipRoot = {
    dom: container,
    props: {
      children: [element]
    },
    alternate: currentRoot
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
  requestAnimationFrame(workLoop);
}
function workLoop() {
  if (!wipRoot && currentRoot) {
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot
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
function performUnitOfWork(fiber) {
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
function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  fiber.hooks = fiber.alternate?.hooks || [];
  const children = [fiber.type(fiber.props)].flat().filter((child) => child != null && typeof child !== "boolean").map((child) => typeof child === "object" ? child : createTextElement(child));
  reconcileChildren(fiber, children);
}
function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}
function reconcileChildren(wipFiber2, elements) {
  let index = 0;
  let oldFiber = wipFiber2.alternate?.child;
  let prevSibling = null;
  const existingFibers = new Map;
  while (oldFiber) {
    const key = oldFiber.key ?? index;
    existingFibers.set(key, oldFiber);
    oldFiber = oldFiber.sibling;
    index++;
  }
  index = 0;
  for (;index < elements.length; index++) {
    const element = elements[index];
    const key = element?.key ?? index;
    const oldFiber2 = existingFibers.get(key);
    const sameType = oldFiber2 && element && element.type === oldFiber2.type;
    let newFiber = null;
    if (sameType) {
      newFiber = {
        type: oldFiber2.type,
        props: element.props,
        dom: oldFiber2.dom,
        parent: wipFiber2,
        alternate: oldFiber2,
        effectTag: "UPDATE",
        hooks: oldFiber2.hooks,
        key
      };
      existingFibers.delete(key);
    } else if (element) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber2,
        alternate: null,
        effectTag: "PLACEMENT",
        key
      };
    }
    if (oldFiber2 && !sameType) {
      oldFiber2.effectTag = "DELETION";
      deletions.push(oldFiber2);
    }
    if (index === 0) {
      wipFiber2.child = newFiber;
    } else if (prevSibling && newFiber) {
      prevSibling.sibling = newFiber;
    }
    if (newFiber) {
      prevSibling = newFiber;
    }
  }
  existingFibers.forEach((fiber) => {
    fiber.effectTag = "DELETION";
    deletions.push(fiber);
  });
}
function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.flat().filter((child) => child != null && typeof child !== "boolean").map((child) => typeof child === "object" ? child : createTextElement(child))
    },
    key: props?.key ?? null
  };
}
function createTextElement(text) {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: []
    }
  };
}
function useState(initial) {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }
  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = {
      state: typeof initial === "function" ? initial() : initial,
      queue: [],
      _needsUpdate: false
    };
    wipFiber.hooks[hookIndex] = hook;
  }
  const setState = (action) => {
    const newState = typeof action === "function" ? action(hook.state) : action;
    hook.state = newState;
    deletions = [];
    nextUnitOfWork = wipRoot;
    requestAnimationFrame(workLoop);
  };
  hookIndex++;
  return [hook.state, setState];
}
function useEffect(callback, deps) {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }
  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = { deps: undefined, _cleanupFn: undefined };
    wipFiber.hooks[hookIndex] = hook;
  }
  const hasChanged = hook.deps === undefined || !deps || deps.some((dep, i) => !Object.is(dep, hook.deps[i]));
  if (hasChanged) {
    if (hook._cleanupFn) {
      hook._cleanupFn();
    }
    setTimeout(() => {
      const newCleanup = callback();
      if (typeof newCleanup === "function") {
        hook._cleanupFn = newCleanup;
      } else {
        hook._cleanupFn = undefined;
      }
    }, 0);
  }
  hook.deps = deps;
  hookIndex++;
}
function Switch({ children }) {
  const childrenArray = Array.isArray(children) ? children : [children];
  const match = childrenArray.find((child) => child && child.props.when);
  if (match) {
    return match;
  }
  return childrenArray.find((child) => child && child.props.default) || null;
}
function Match({ when, children }) {
  return when ? children : null;
}
function Show({ when, children }) {
  return when ? children : null;
}
function showToast(message, duration = 3000) {
  if (window.Android && typeof window.Android.showToast === "function") {
    window.Android.showToast(message, duration);
  } else {
    console.log(`[showToast] ${message}`);
  }
}
function useRef(initial) {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }
  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = { current: initial };
    wipFiber.hooks[hookIndex] = hook;
  }
  hookIndex++;
  return hook;
}
function useLayoutEffect(callback, deps) {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }
  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = { deps: undefined, _cleanupFn: undefined };
    wipFiber.hooks[hookIndex] = hook;
  }
  const hasChanged = hook.deps === undefined || !deps || deps.some((dep, i) => !Object.is(dep, hook.deps[i]));
  if (hasChanged) {
    if (hook._cleanupFn) {
      hook._cleanupFn();
    }
    const cleanup = callback();
    if (typeof cleanup === "function") {
      hook._cleanupFn = cleanup;
    } else {
      hook._cleanupFn = undefined;
    }
  }
  hook.deps = deps;
  hookIndex++;
}
function useReducer(reducer, initialState) {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }
  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = {
      state: initialState,
      queue: []
    };
    wipFiber.hooks[hookIndex] = hook;
  }
  hook.queue.forEach((action) => {
    hook.state = reducer(hook.state, action);
  });
  hook.queue = [];
  const dispatch = (action) => {
    hook.queue.push(action);
    if (!isRenderScheduled) {
      isRenderScheduled = true;
      requestAnimationFrame(workLoop);
    }
  };
  hookIndex++;
  return [hook.state, dispatch];
}
function useContext(Context) {
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
function createContext(defaultValue) {
  const context = {
    _defaultValue: defaultValue,
    Provider: function Provider({ children }) {
      return children;
    }
  };
  context.Provider._context = context;
  return context;
}
function useMemo(factory, deps) {
  if (!wipFiber) {
    throw new Error("Hooks can only be called inside a Vader.js function component.");
  }
  let hook = wipFiber.hooks[hookIndex];
  if (!hook) {
    hook = { memoizedValue: factory(), deps };
    wipFiber.hooks[hookIndex] = hook;
  }
  const hasChanged = hook.deps === undefined || !deps || deps.some((dep, i) => !Object.is(dep, hook.deps[i]));
  if (hasChanged) {
    hook.memoizedValue = factory();
    hook.deps = deps;
  }
  hookIndex++;
  return hook.memoizedValue;
}
function useCallback(callback, deps) {
  return useMemo(() => callback, deps);
}
function useArray(initialValue = []) {
  const [array, setArray] = useState(initialValue);
  const add = (item) => {
    setArray((prevArray) => [...prevArray, item]);
  };
  const remove = (index) => {
    setArray((prevArray) => prevArray.filter((_, i) => i !== index));
  };
  const update = (index, item) => {
    setArray((prevArray) => prevArray.map((prevItem, i) => i === index ? item : prevItem));
  };
  return { array, add, remove, update };
}
function useInterval(callback, delay) {
  useEffect(() => {
    if (delay === null)
      return;
    const interval = setInterval(callback, delay);
    return () => clearInterval(interval);
  }, [callback, delay]);
}
var DEFAULT_CACHE_OPTIONS = {
  expiryMs: 5 * 60 * 1000,
  enabled: true
};
var queryCache = new Map;
function useQuery(url, cacheOptions = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const {
    enabled = DEFAULT_CACHE_OPTIONS.enabled,
    expiryMs = DEFAULT_CACHE_OPTIONS.expiryMs
  } = cacheOptions;
  const mergedCacheOptions = useMemo(() => ({
    enabled,
    expiryMs
  }), [enabled, expiryMs]);
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (mergedCacheOptions.enabled) {
        const cached = queryCache.get(url);
        const now = Date.now();
        if (cached && now - cached.timestamp < mergedCacheOptions.expiryMs) {
          setData(cached.data);
          setLoading(false);
          return;
        }
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
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
  }, [url, mergedCacheOptions]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  return { data, loading, error, refetch: fetchData };
}
function useWindowFocus() {
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
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });
  const setValue = (value) => {
    try {
      setStoredValue(value);
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error("Error saving to localStorage", error);
    }
  };
  return [storedValue, setValue];
}
function Link({
  to,
  className,
  children
}) {
  const handleClick = (e) => {
    e.preventDefault();
    const normalized = to.startsWith("/") ? to : "/" + to;
    if (window.Android && typeof window.Android.navigate === "function") {
      window.Android.navigate(normalized);
      return;
    }
    if (location.protocol === "file:") {
      location.href = normalized + "/index.html";
      return;
    }
    window.location.href = normalized;
  };
  return createElement("a", {
    href: to,
    onClick: handleClick,
    className
  }, ...children);
}
function useOnClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        handler(event);
      }
    };
    document.addEventListener("mousedown", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
    };
  }, [ref, handler]);
}
var Vader = {
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
  showToast
};
Object.defineProperty(window, "Vader", {
  value: Vader,
  writable: false,
  configurable: false
});

// app/index.tsx
"use client";
function Counter() {
  const [count, setCount] = useState(0);
  return /* @__PURE__ */ createElement("div", {
    class: "p-4"
  }, /* @__PURE__ */ createElement("h1", {
    class: "text-3xl font-bold underline text-center mb-4"
  }, "Counter: ", count), /* @__PURE__ */ createElement("div", {
    class: "flex justify-center"
  }, /* @__PURE__ */ createElement("button", {
    class: "bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mr-2",
    onClick: () => setCount(count + 1)
  }, "Increment"), /* @__PURE__ */ createElement("button", {
    class: "bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded",
    onClick: () => setCount(count - 1)
  }, "Decrement"), /* @__PURE__ */ createElement("p", null, "HMR WORKS")));
}
render(/* @__PURE__ */ createElement(Counter, null), document.getElementById("app"));

//# debugId=56A55626F9E1C1F464756E2164756E21
