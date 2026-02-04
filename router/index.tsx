import * as Vader from "../index";

export interface Route {
  path: string;
  component: any;
  layout?: any;
  name?: string;
  meta?: Record<string, any>;
  children?: Route[];
}

export interface RouteConfig {
  routes: Route[];
  mode?: "hash" | "history";
  base?: string;
  fallback?: any; // Fallback component for 404
}

export interface RouteMatch {
  route: Route;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

class Router {
  private routes: Route[] = [];
  private routeMap: Map<string, Route> = new Map();
  private currentMatch: RouteMatch | null = null;
  private listeners: Array<(match: RouteMatch | null) => void> = [];
  private mode: "hash" | "history" = "history";
  private base: string = "";
  private fallback: any = null;
  private AppComponent: any = null;

  constructor(config: RouteConfig) {
    this.mode =  Vader.platform() === "web" ? (config.mode || "history") : "hash";
    this.base = config.base || "";
    this.fallback = config.fallback || null;
    this.routes = config.routes;
    
    // Build route map with nested routes
    this.buildRouteMap(config.routes);
    
    // Initialize the router
    this.initializeRouter();
  }

  /**
   * Set the root App component
   */
  public setAppComponent(App: any): void {
    this.AppComponent = App;
  }

  /**
   * Get the root App component
   */
  public getAppComponent(): any {
    return this.AppComponent;
  }

  /**
   * Recursively build route map including nested routes
   */
  private buildRouteMap(routes: Route[], parentPath: string = ""): void {
    routes.forEach((route) => {
      const fullPath = this.normalizePath(parentPath + route.path);
      this.routeMap.set(fullPath, route);
      
      // Register children routes recursively
      if (route.children && route.children.length > 0) {
        this.buildRouteMap(route.children, fullPath);
      }
    });
  }

  /**
   * Normalize path
   */
  private normalizePath(path: string): string {
    if (path === "/") return "/";
    
    // Remove duplicate slashes
    let normalized = path.replace(/\/+/g, "/");
    
    // Ensure it doesn't end with slash (except root)
    if (normalized !== "/" && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    
    // Ensure it starts with slash
    if (!normalized.startsWith("/")) {
      normalized = "/" + normalized;
    }
    
    return normalized;
  }

  /**
   * Match path against routes with dynamic parameters
   */
  private matchPath(path: string): RouteMatch | null {
    const normalizedPath = this.normalizePath(path);
    
    // Try exact match first
    const exactRoute = this.routeMap.get(normalizedPath);
    if (exactRoute) {
      return {
        route: exactRoute,
        path: normalizedPath,
        params: {},
        query: this.getQueryParams(),
      };
    }
    
    // Try pattern matching for dynamic routes
    for (const [routePath, route] of this.routeMap.entries()) {
      const match = this.matchPattern(routePath, normalizedPath);
      if (match) {
        return {
          route,
          path: normalizedPath,
          params: match.params,
          query: this.getQueryParams(),
        };
      }
    }
    
    return null;
  }

  /**
   * Match path pattern with parameters (e.g., /users/:id)
   */
  private matchPattern(pattern: string, path: string): { params: Record<string, string> } | null {
    const patternParts = pattern.split("/");
    const pathParts = path.split("/");
    
    if (patternParts.length !== pathParts.length) {
      return null;
    }
    
    const params: Record<string, string> = {};
    
    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];
      
      if (patternPart.startsWith(":")) {
        // Dynamic segment
        const paramName = patternPart.slice(1);
        params[paramName] = decodeURIComponent(pathPart);
      } else if (patternPart !== pathPart) {
        // Static segment doesn't match
        return null;
      }
    }
    
    return { params };
  }

  /**
   * Initialize router with event listeners
   */
private initializeRouter(): void {
  if (typeof window === "undefined") return;

  // Handle back / forward
  window.addEventListener("popstate", () => {
    this.handleLocationChange();
  });

  // 🔥 PATCH pushState / replaceState
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  history.pushState = (...args) => {
    originalPush.apply(history, args as any);
    this.handleLocationChange();
  };

  history.replaceState = (...args) => {
    originalReplace.apply(history, args as any);
    this.handleLocationChange();
  };

  // Initial match
  this.handleLocationChange();
}


  /**
   * Handle location change
   */
  private handleLocationChange(): void {
    const path = this.getCurrentPath();
    const match = this.matchPath(path);
    
    if (match) {
      this.currentMatch = match;
    } else {
      this.currentMatch = null;
    }
    
    // Notify all listeners
    this.listeners.forEach((listener) => listener(this.currentMatch));
  }

  /**
   * Get current path from URL
   */
  private getCurrentPath(): string {
    if (typeof window === "undefined") return "/";
    
    if (this.mode === "hash") {
      return window.location.hash.slice(1) || "/";
    } else {
      let path = window.location.pathname;
      
      // Remove base path if configured
      if (this.base && path.startsWith(this.base)) {
        path = path.slice(this.base.length);
      }
      
      return this.normalizePath(path) || "/";
    }
  }

  /**
   * Navigate to a new path
   */
  public navigate(
    path: string,
    options: {
      replace?: boolean;
      state?: any;
      query?: Record<string, string>;
    } = {}
  ): void {
    const normalizedPath = this.normalizePath(path);
    
    // Build URL with query params
    let url = normalizedPath;
    if (options.query && Object.keys(options.query).length > 0) {
      const queryString = new URLSearchParams(options.query).toString();
      url += `?${queryString}`;
    }
    
    if (typeof window !== "undefined") {
      const fullUrl = this.mode === "hash" ? `#${url}` : this.base + url;
      
      if (options.replace) {
        window.history.replaceState(options.state || {}, "", fullUrl);
      } else {
        window.history.pushState(options.state || {}, "", fullUrl);
      }
      
      this.handleLocationChange();
    }
  }

  /**
   * Subscribe to route changes
   */
 public on(callback: (match: RouteMatch | null) => void): () => void {
  this.listeners.push(callback);

  // 🔥 Always emit current state (even null)
  callback(this.currentMatch);

  return () => {
    this.listeners = this.listeners.filter(l => l !== callback);
  };
}



  /**
   * Get current route match
   */
  public getCurrentMatch(): RouteMatch | null {
    return this.currentMatch;
  }

  /**
   * Get current route
   */
  public getCurrentRoute(): Route | null {
    return this.currentMatch?.route || null;
  }

  /**
   * Get query parameters from URL
   */
  public getQueryParams(): Record<string, string> {
    if (typeof window === "undefined") return {};
    
    const params: Record<string, string> = {};
    const queryString = window.location.search.slice(1);
    
    if (!queryString) return params;
    
    queryString.split("&").forEach((param) => {
      const [key, value] = param.split("=");
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || "");
      }
    });
    
    return params;
  }

  /**
   * Check if a path is active
   */
  public isActive(path: string, exact: boolean = false): boolean {
    const currentPath = this.currentMatch?.path || "/";
    const normalizedPath = this.normalizePath(path);
    
    if (exact) {
      return currentPath === normalizedPath;
    }
    
    return currentPath.startsWith(normalizedPath);
  }

  /**
   * Go back in history
   */
  public back(): void {
    if (typeof window !== "undefined") {
      window.history.back();
    }
  }

  /**
   * Go forward in history
   */
  public forward(): void {
    if (typeof window !== "undefined") {
      window.history.forward();
    }
  }

  /**
   * Get the fallback component for 404
   */
  public getFallback(): any {
    return this.fallback;
  }
}

// Create a singleton instance
let routerInstance: Router | null = null;

/**
 * Create and initialize router
 */
export function createRouter(config: RouteConfig): Router {
  routerInstance = new Router(config);
  return routerInstance;
}

/**
 * Get router instance
 */
export function useRouter(): Router {
  if (!routerInstance) {
    throw new Error("Router not initialized. Call createRouter() first.");
  }
  return routerInstance;
}

/**
 * Hook for getting current route
 */
export function useRoute(): RouteMatch | null {
  const router = useRouter();
  const [match, setMatch] = Vader.useState<RouteMatch | null>(
    router.getCurrentMatch()
  );
  
  console.log("useRoute - current match:", match);

  Vader.useEffect(() => {
    const unsubscribe = router.on((newMatch) => {
      setMatch(newMatch);
    });
    
    return unsubscribe;
  }, []);

  return match;
}

/**
 * Hook for navigation
 */
export function useNavigate() {
  const router = useRouter();
  
  return (
    path: string,
    options?: {
      replace?: boolean;
      state?: any;
      query?: Record<string, string>;
    }
  ) => {
    router.navigate(path, options);
  };
}

/**
 * Hook for checking active route
 */
export function useActiveRoute(path: string, exact: boolean = false): boolean {
  const router = useRouter();
  const [isActive, setIsActive] = Vader.useState(() => router.isActive(path, exact));

  Vader.useEffect(() => {
    const unsubscribe = router.on(() => {
      setIsActive(router.isActive(path, exact));
    });
    
    return unsubscribe;
  }, [path, exact]);

  return isActive;
}

export default Router;