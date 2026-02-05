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
  fallback?: any;
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
  private fallback: any = null;
  private ready = false;

  constructor(config: RouteConfig) {
    this.routes = config.routes;
    this.fallback = config.fallback || null;

    this.buildRouteMap(this.routes);
    this.initializeRouter();
  }

  /* ----------------------- ROUTE MAP ----------------------- */

  private buildRouteMap(routes: Route[], parentPath = ""): void {
    routes.forEach(route => {
      const fullPath = this.normalizePath(parentPath + route.path);
      this.routeMap.set(fullPath, route);

      if (route.children?.length) {
        this.buildRouteMap(route.children, fullPath);
      }
    });
  }

  private normalizePath(path: string): string {
    if (path === "/") return "/";
    let p = path.replace(/\/+/g, "/");
    if (!p.startsWith("/")) p = "/" + p;
    if (p !== "/" && p.endsWith("/")) p = p.slice(0, -1);
    return p;
  }

  /* ----------------------- MATCHING ----------------------- */

  private matchPath(path: string): RouteMatch | null {
    const normalized = this.normalizePath(path);

    const exact = this.routeMap.get(normalized);
    if (exact) {
      return {
        route: exact,
        path: normalized,
        params: {},
        query: this.getQueryParams()
      };
    }

    for (const [pattern, route] of this.routeMap.entries()) {
      const match = this.matchPattern(pattern, normalized);
      if (match) {
        return {
          route,
          path: normalized,
          params: match.params,
          query: this.getQueryParams()
        };
      }
    }

    return null;
  }

  private matchPattern(pattern: string, path: string) {
    const p1 = pattern.split("/");
    const p2 = path.split("/");

    if (p1.length !== p2.length) return null;

    const params: Record<string, string> = {};

    for (let i = 0; i < p1.length; i++) {
      if (p1[i].startsWith(":")) {
        params[p1[i].slice(1)] = decodeURIComponent(p2[i]);
      } else if (p1[i] !== p2[i]) {
        return null;
      }
    }

    return { params };
  }

  /* ----------------------- INIT ----------------------- */

  private initializeRouter(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("hashchange", () => {
      this.handleLocationChange();
    });

    this.handleLocationChange();
    this.ready = true;
  }

  private handleLocationChange(): void {
    const path = this.getCurrentPath();
    const match = this.matchPath(path);
    this.currentMatch = match;

    this.listeners.forEach(l => l(this.currentMatch));
  }

  private getCurrentPath(): string {
    if (typeof window === "undefined") return "/";
    return this.normalizePath(window.location.hash.slice(1) || "/");
  }

  /* ----------------------- NAVIGATION ----------------------- */

  public navigate(
    path: string,
    options: { replace?: boolean; query?: Record<string, string> } = {}
  ): void {
    let url = this.normalizePath(path);

    if (options.query && Object.keys(options.query).length) {
      url += "?" + new URLSearchParams(options.query).toString();
    }

    const full = `#${url}`;

    if (options.replace) {
      window.location.replace(full);
    } else {
      window.location.hash = full;
    }
    this.handleLocationChange()
  }

  /* ----------------------- SUBSCRIPTIONS ----------------------- */

  public on(cb: (match: RouteMatch | null) => void): () => void {
    this.listeners.push(cb);
    if (this.ready) cb(this.currentMatch);

    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  /* ----------------------- HELPERS ----------------------- */

  public isReady(): boolean {
    return this.ready;
  }

  public getCurrentMatch(): RouteMatch | null {
    return this.currentMatch;
  }

  public getCurrentRoute(): Route | null {
    return this.currentMatch?.route || null;
  }

  public getFallback(): any {
    return this.fallback;
  }

  public getQueryParams(): Record<string, string> {
    if (typeof window === "undefined") return {};
    const params: Record<string, string> = {};
    const qs = window.location.search.slice(1);
    if (!qs) return params;

    qs.split("&").forEach(p => {
      const [k, v] = p.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    });

    return params;
  }

  public isActive(path: string, exact = false): boolean {
    const current = this.currentMatch?.path || "/";
    const target = this.normalizePath(path);
    return exact ? current === target : current.startsWith(target);
  }

  public back() {
    window.history.back();
  }

  public forward() {
    window.history.forward();
  }
}

/* ----------------------- SINGLETON ----------------------- */

let routerInstance: Router | null = null;

export function createRouter(config: RouteConfig): Router {
  routerInstance = new Router(config);
  return routerInstance;
}

export function useRouter(): Router {
  if (!routerInstance) {
    throw new Error("Router not initialized");
  }
  return routerInstance;
}

/* ----------------------- HOOKS ----------------------- */

export function useRoute(): RouteMatch | null | "loading" {
  const router = useRouter();
  const [match, setMatch] = Vader.useState<RouteMatch | null | "loading">(
    router.isReady() ? router.getCurrentMatch() : "loading"
  );

  Vader.useEffect(() => {
    return router.on(setMatch);
  }, []);

  return match;
}

export function useNavigate() {
  const router = useRouter();
  return router.navigate.bind(router);
}

export function useActiveRoute(path: string, exact = false): boolean {
  const router = useRouter();
  const [active, setActive] = Vader.useState(
    router.isActive(path, exact)
  );

  Vader.useEffect(() => {
    return router.on(() => {
      setActive(router.isActive(path, exact));
    });
  }, [path, exact]);

  return active;
}

export default Router;
