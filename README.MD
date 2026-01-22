<p align="center">
  <a href="https://vaderjs-native.vercel.app/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="/icon.jpeg">
      <img src="https://github.com/Postr-Inc/Vader.js/blob/main/logo.png" height="128">
    </picture>
    <h1 align="center">Vader.js</h1>
  </a>
</p>

**A modern, reactive framework for building ultra-fast native mobile apps with comprehensive Android bridge integration — minimal, blazing fast, and feature-rich.**

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Postr-Inc/Vader.js/blob/main/LICENSE)
[![npm version](https://img.shields.io/npm/v/vaderjs.svg?style=flat)](https://www.npmjs.com/package/vaderjs)
 

## ✨ Why Choose VaderNative?

* ✅ **Ultra-minimal reactivity** – no virtual DOM overhead, direct DOM updates
* ✅ **Full Android bridge integration** – access native device features seamlessly
* ✅ **File-based routing** – Next.js-inspired, production-ready
* ✅ **Tiny runtime** – under 20KB gzipped
* ✅ **React-inspired API** – familiar hooks and components
* ✅ **D-pad navigation** – built-in TV and remote control support
* ✅ **Persistent file system** – read/write files directly on Android
* ✅ **Comprehensive hooks** – all essential React hooks implemented
* ✅ **TypeScript ready** – full type definitions included
 

## 🚀 Feature Highlights

### **Native Android Bridge**
- **File System Access**: Read, write, delete, and list files directly on Android
- **Native Dialogs**: System-level alert and confirmation dialogs
- **Toast Notifications**: Native Android toast messages
- **Permissions Management**: Request camera, storage, microphone, and notification permissions
- **D-pad Navigation**: Full TV remote and game controller support
- **Hardware Keys**: Handle back button, media keys, and navigation buttons

### **Modern React API**
- **All Essential Hooks**: `useState`, `useEffect`, `useReducer`, `useMemo`, `useCallback`, `useRef`
- **Advanced Hooks**: `useQuery`, `useArray`, `useWindowFocus`, `useLocalStorage`, `useInterval`
- **Conditional Rendering**: `Switch`, `Match`, `Show` components
- **Context API**: Full `createContext` and `useContext` support
- **Focus Management**: Automatic D-pad navigation for TV apps

### **Performance First**
- **Zero Virtual DOM**: Direct DOM reconciliation
- **Smart Reconciliation**: Key-based diffing algorithm
- **RequestAnimationFrame**: Optimized rendering loop
- **Memory Efficient**: Minimal garbage collection pressure

 
## 📦 Installation

```bash
# Using bun (recommended)
bun install vaderjs@latest

# Using npm
npm install vaderjs@latest

# Using yarn
yarn add vaderjs@latest
```

 

## ⚡ Quick Start

### Counter App with Android Features

```tsx
import * as Vader from "vaderjs-native";
import { useState, useEffect, showToast, FileSystem } from "vaderjs-native";

function Counter() {
  const [count, setCount] = useState(0);
  
  // Load count from Android file system on startup
  useEffect(async () => {
    const data = await FileSystem.loadJSON("counter_data.json");
    if (data?.count) setCount(data.count);
  }, []);
  
  // Save count to file whenever it changes
  useEffect(() => {
    FileSystem.saveJSON("counter_data.json", { count, timestamp: Date.now() });
  }, [count]);
  
  const increment = () => {
    setCount(count + 1);
    showToast(`Count: ${count + 1}`);
  };
  
  return (
    <div style={{ padding: 20, backgroundColor: "#1a1a1a", minHeight: "100vh" }}>
      <h1 style={{ color: "white", fontSize: 48 }}>Persistent Counter</h1>
      <p style={{ color: "#ccc", fontSize: 24 }}>Count: {count}</p>
      <button 
        onClick={increment}
        style={{
          padding: "12px 24px",
          fontSize: 18,
          backgroundColor: "#007AFF",
          color: "white",
          border: "none",
          borderRadius: 8
        }}
      >
        Increment (+1)
      </button>
    </div>
  );
}

Vader.render(<Counter />, document.getElementById("app"));
```

 

## 📁 Project Structure

VaderNative uses file-based routing similar to Next.js:

```
/app
  /index.jsx                 -> Homepage (/)
  /about.jsx                 -> About page (/about)
  /users/[id].jsx            -> Dynamic route (/users/:id)
  /settings/[[...slug]].jsx  -> Optional catch-all (/settings/*)

/src
  /components               -> Shared components
  /hooks                    -> Custom hooks
  /utils                    -> Utility functions

/public
  /assets                   -> Static assets (images, fonts)

vader.config.ts            -> App configuration
```

 
## 🛠 Configuration

Create a `vader.config.ts` file:

```typescript
import defineConfig from "vaderjs-native/config";
import tailwind from "vaderjs-native/plugins/tailwind";

export default defineConfig({
  app: {
    name: "My VaderNative App",
    id: "com.example.app",
    version: {
      code: 1,
      name: "1.0.0",
    },
  },

  platforms: {
    android: {
      minSdk: 24,
      targetSdk: 34,
      permissions: [
        "INTERNET",
        "ACCESS_NETWORK_STATE",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE",
        "CAMERA"
      ],
    },
    web: {
      title: "VaderNative App",
      themeColor: "#111827",
    },
  },

  plugins: [tailwind]
});
```

 
## 🔧 Core API Reference

### **Hooks**

| Hook | Description | Example |
|------|-------------|---------|
| `useState` | Component state management | `const [count, setCount] = useState(0)` |
| `useEffect` | Side effects and lifecycle | `useEffect(() => { fetchData() }, [])` |
| `useReducer` | Complex state logic | `const [state, dispatch] = useReducer(reducer, initialState)` |
| `useMemo` | Memoize expensive calculations | `const value = useMemo(() => compute(a, b), [a, b])` |
| `useCallback` | Memoize callback functions | `const cb = useCallback(() => doSomething(), [])` |
| `useRef` | Mutable references | `const ref = useRef(null)` |
| `useContext` | Context consumption | `const value = useContext(MyContext)` |
| `useArray` | Array state with helpers | `const {array, add, remove} = useArray([])` |
| `useQuery` | Data fetching with caching | `const {data, loading} = useQuery("/api/data")` |
| `useLocalStorage` | Sync state with localStorage | `const [value, setValue] = useLocalStorage("key", init)` |
| `useInterval` | Run functions at intervals | `useInterval(() => {}, 1000)` |
| `useWindowFocus` | Track window focus state | `const isFocused = useWindowFocus()` |
| `useOnClickOutside` | Detect clicks outside element | `useOnClickOutside(ref, handler)` |

### **Android Bridge Features**

| Feature | Method | Description |
|---------|--------|-------------|
| **File System** | `FileSystem.saveJSON()` | Save JSON data to Android storage |
| | `FileSystem.loadJSON()` | Load JSON data from storage |
| | `FileSystem.exists()` | Check if file exists |
| | `FS.readFile()` | Read any file as string |
| | `FS.writeFile()` | Write any file content |
| | `FS.deleteFile()` | Delete files |
| | `FS.listDir()` | List directory contents |
| **UI** | `showToast()` | Show native Android toast |
| | `useDialog().alert()` | Native alert dialog |
| | `useDialog().confirm()` | Native confirmation dialog |
| **Permissions** | `usePermission().request()` | Request Android permissions |
| | `usePermission().has()` | Check permission status |
| **Navigation** | `Link` component | Native-aware navigation |
| | Android back button | Automatic handling |
| **D-pad** | Auto-focus management | TV remote navigation |
| | Hardware key support | Game controllers, remotes |

### **Components**

| Component | Description | Example |
|-----------|-------------|---------|
| `Switch` | Conditional rendering switcher | `<Switch>{matches}</Switch>` |
| `Match` | Condition for Switch | `<Match when={cond}>{content}</Match>` |
| `Show` | Conditional render | `<Show when={cond}>{content}</Show>` |
| `Link` | Navigation link | `<Link to="/about">About</Link>` |

### **Focus Management**

VaderNative includes a sophisticated D-pad navigation system for TV apps:

```typescript
// Automatic focus management - no setup needed!
// Just use standard HTML elements:

<button>Button 1</button>      // Focusable with D-pad
<a href="#">Link</a>          // Focusable with D-pad
<input type="text" />         // Focusable with D-pad

// Manual focus control:
const focusManager = new FocusManager();
focusManager.focusFirst();    // Focus first element
focusManager.focusElement(el); // Focus specific element
```
 

## 📊 File System Example

```typescript
import { FileSystem, useEffect, useState } from "vaderjs-native";

function UserProfile() {
  const [user, setUser] = useState(null);
  
  useEffect(async () => {
    // Load user data from Android storage
    const savedUser = await FileSystem.loadJSON("user_profile.json");
    if (savedUser) {
      setUser(savedUser);
    } else {
      // Create default profile
      const defaultUser = {
        name: "Guest",
        theme: "dark",
        preferences: { language: "en" }
      };
      await FileSystem.saveJSON("user_profile.json", defaultUser);
      setUser(defaultUser);
    }
  }, []);
  
  const saveProfile = async (updates) => {
    const updated = { ...user, ...updates };
    const success = await FileSystem.saveJSON("user_profile.json", updated);
    if (success) {
      setUser(updated);
      showToast("Profile saved!");
    }
  };
  
  return (
    <div>
      <h1>{user?.name}'s Profile</h1>
      <button onClick={() => saveProfile({ theme: "light" })}>
        Set Light Theme
      </button>
    </div>
  );
}
```

 
## 📱 Android-Specific Features

### **Permission Management**

```typescript
const permissions = usePermission();

// Request camera access
const takePhoto = async () => {
  const hasCamera = await permissions.has("camera");
  if (!hasCamera) {
    const granted = await permissions.request("camera");
    if (!granted) {
      showToast("Camera permission required");
      return;
    }
  }
  // Take photo logic...
};
```

### **Native Dialogs**

```typescript
const dialog = useDialog();

const deleteItem = async () => {
  const confirmed = await dialog.confirm({
    title: "Delete Item",
    message: "Are you sure you want to delete this item?",
    okText: "Delete",
    cancelText: "Cancel"
  });
  
  if (confirmed) {
    // Delete logic...
  }
};
```

### **D-pad Navigation Events**

```javascript
// Listen for D-pad navigation events
document.addEventListener('dpadfocus', (e) => {
  console.log('Element focused:', e.detail.element);
});

// Listen for back button
document.addEventListener('dpadback', () => {
  // Handle back navigation
});
```

 

## 🎯 Performance Features

### **Automatic Batching**
State updates are automatically batched for optimal performance.

### **Key-Based Reconciliation**
Efficient DOM updates using React-like key prop support.

### **Smart Re-rendering**
Components only re-render when their props or state actually change.

### **Minimal Bundle Size**
- Core runtime: < 20KB
- Full feature set: < 25KB
- No external dependencies

 

## 🔄 Data Fetching with Caching

```typescript
import { useQuery } from "vaderjs-native";

function DataDashboard() {
  // Automatically caches for 5 minutes
  const { data, loading, error, refetch } = useQuery(
    "https://api.example.com/data",
    { expiryMs: 300000 } // 5 minutes cache
  );
  
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return (
    <div>
      <h1>Dashboard</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

 

## 📦 Building for Production

```bash
# Build for Android
bun run build:android

# Build for Web
bun run build:web

# Development server with hot reload
bun run dev
```

 

## 🆚 Comparison with Other Frameworks

| Feature | VaderNative | React Native | Flutter | NativeScript |
|---------|-------------|--------------|---------|--------------|
| **Bundle Size** | < 25KB | ~2MB | ~5MB | ~5MB |
| **Startup Time** | Instant | Slow | Slow | Medium |
| **Android Bridge** | Built-in | Via Native Modules | Via Plugins | Via Plugins |
| **D-pad Support** | Built-in | Requires Setup | Requires Setup | Requires Setup |
| **File System** | Direct Access | AsyncStorage | path_provider | file-system |
| **Learning Curve** | Easy (React-like) | Medium | Hard (Dart) | Medium |
| **Memory Usage** | Very Low | High | High | Medium |

 
## 🚀 Getting Started Template

```bash
 

# Install dependencies
bun install

# Create new VaderNative project
bun run vaderjs init
cd my-app

# Start development server
bun run dev

# Build for production
bun run android:build or bun run build
```
 

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/Postr-Inc/Vader.js/blob/main/CONTRIBUTING.md) for details.

## 📄 License

VaderNative is [MIT licensed](https://github.com/Postr-Inc/Vader.js/blob/main/LICENSE).
 

