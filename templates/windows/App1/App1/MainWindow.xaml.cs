using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace App1
{
    public static class Logger
    {
        private static readonly string LogFilePath = Path.Combine(AppContext.BaseDirectory, "app.log");
        private static readonly object _lock = new object();

        public static void Log(string message)
        {
            try
            {
                string line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}";
                lock (_lock)
                {
                    File.AppendAllText(LogFilePath, line + Environment.NewLine);
                }
            }
            catch
            {
                // Fail silently if logging fails
            }
        }

        public static void LogException(Exception ex, string context = "")
        {
            Log($"ERROR in {context}: {ex.Message}\n{ex.StackTrace}");
        }
    }

    public sealed partial class MainWindow : Window
    {
        private readonly string _allowedBaseDirectory = AppContext.BaseDirectory;
        private readonly string _allowedDataDirectory;

        private string WebViewUrl = $"file:///{Path.Combine(AppContext.BaseDirectory, "Web", "index.html").Replace("\\", "/")}";

        public MainWindow()
        {
            this.InitializeComponent();
            this.Title = "MyApp";
            // Extends the app into the title bar area
            this.ExtendsContentIntoTitleBar = true;
            _allowedDataDirectory = Path.Combine(_allowedBaseDirectory, "WebData");
            Directory.CreateDirectory(_allowedDataDirectory);

            Logger.Log("=== App Started ===");
            Logger.Log($"Base Directory: {_allowedBaseDirectory}");
            Logger.Log($"Data Directory: {_allowedDataDirectory}");

            // Navigate immediately
            MyWebView.Source = new Uri(WebViewUrl);

            // Initialize WebView2
            InitializeWebView();
        }

        private async void InitializeWebView()
        {
            try
            {
                await MyWebView.EnsureCoreWebView2Async();
                MyWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
                Logger.Log("WebView2 initialized and ready for messages");
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "InitializeWebView");
            }
        }

         private async void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            string requestId = "";

            try
            {
                string jsonString = args.WebMessageAsJson;
                Logger.Log($"=== Received Message ===\nRaw JSON: {jsonString}");

                using var doc = JsonDocument.Parse(jsonString);
                var root = doc.RootElement;

                if (!root.TryGetProperty("command", out var commandElement) ||
                    !root.TryGetProperty("id", out var idElement))
                {
                    Logger.Log("ERROR: Invalid message format");
                    return;
                }

                string command = commandElement.GetString() ?? "";
                requestId = idElement.GetString() ?? "";

                Logger.Log($"Command: {command}, Request ID: {requestId}");

                switch (command)
                {
                    case "writeFile":
                        await HandleWriteFile(requestId, root);
                        break;
                    case "readFile":
                        await HandleReadFile(requestId, root);
                        break;
                    case "deleteFile":
                        await HandleDeleteFile(requestId, root);
                        break;
                    case "listDir":
                        await HandleListDir(requestId, root);
                        break;
                    case "setWindowSize":
                        HandleSetWindowSize(requestId, root);
                        break;
                    case "openExternal":
                        HandleOpenExternal(requestId, root);
                        break;
                    case "showInFolder":
                        HandleShowInFolder(requestId, root);
                        break;
                    default:
                        Logger.Log($"ERROR: Unknown command: {command}");
                        SendErrorResponse(requestId, $"Unknown command: {command}");
                        break;
                }
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "OnWebMessageReceived");
                SendErrorResponse(requestId, $"Internal error: {ex.Message}");
            }
        }

        // --- New Helper Methods for the Template ---

        private void HandleSetWindowSize(string requestId, JsonElement root)
        {
            try
            {
                int width = root.GetProperty("width").GetInt32();
                int height = root.GetProperty("height").GetInt32();
                this.AppWindow.Resize(new Windows.Graphics.SizeInt32(width, height));
                SendResponse(requestId, true);
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "HandleSetWindowSize");
                SendErrorResponse(requestId, "Invalid width or height");
            }
        }

        private void HandleOpenExternal(string requestId, JsonElement root)
        {
            try
            {
                string? url = root.TryGetProperty("url", out var urlElement) ? urlElement.GetString() : null;
                if (!string.IsNullOrEmpty(url))
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
                    SendResponse(requestId, true);
                }
                else
                {
                    SendErrorResponse(requestId, "URL is null or empty");
                }
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "HandleOpenExternal");
                SendErrorResponse(requestId, ex.Message);
            }
        }

        private void HandleShowInFolder(string requestId, JsonElement root)
        {
            try
            {
                string? path = root.TryGetProperty("path", out var pathElement) ? pathElement.GetString() : null;
                if (!string.IsNullOrEmpty(path))
                {
                    // /select highlights the file in the explorer window
                    System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{path}\"");
                    SendResponse(requestId, true);
                }
                else
                {
                    SendErrorResponse(requestId, "Path is null or empty");
                }
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "HandleShowInFolder");
                SendErrorResponse(requestId, ex.Message);
            }
        }

        private async Task HandleWriteFile(string requestId, JsonElement root)
        {
            try
            {
                if (!root.TryGetProperty("path", out var pathElement) ||
                    !root.TryGetProperty("content", out var contentElement))
                {
                    Logger.Log("ERROR: Missing path or content");
                    SendErrorResponse(requestId, "Missing path or content");
                    return;
                }

                string requestedPath = pathElement.GetString() ?? "";
                string content = contentElement.GetString() ?? "";

                Logger.Log($"=== HandleWriteFile === Original path: '{requestedPath}', Content length: {content?.Length ?? 0}");

                requestedPath = Path.GetFileName(requestedPath); // sanitize absolute paths

                if (string.IsNullOrWhiteSpace(requestedPath) || requestedPath.Contains("..") || requestedPath.Contains("~"))
                {
                    Logger.Log($"ERROR: Invalid or unsafe path '{requestedPath}'");
                    SendErrorResponse(requestId, "Path invalid or not allowed");
                    return;
                }

                string safePath = Path.Combine(_allowedDataDirectory, requestedPath);
                safePath = Path.GetFullPath(safePath);

                if (!safePath.StartsWith(_allowedDataDirectory, StringComparison.OrdinalIgnoreCase))
                {
                    Logger.Log($"SECURITY ERROR: Path escaped data directory: {safePath}");
                    SendErrorResponse(requestId, "Path not allowed");
                    return;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(safePath) ?? _allowedDataDirectory);

                await File.WriteAllTextAsync(safePath, content);
                Logger.Log($"SUCCESS: File written to: {safePath}");
                SendResponse(requestId, true);
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "HandleWriteFile");
                SendErrorResponse(requestId, $"Write failed: {ex.Message}");
            }
        }

        private async Task HandleReadFile(string requestId, JsonElement root)
        {
            try
            {
                if (!root.TryGetProperty("path", out var pathElement))
                {
                    Logger.Log("ERROR: Missing path in ReadFile");
                    SendErrorResponse(requestId, "Missing path");
                    return;
                }

                string requestedPath = Path.GetFileName(pathElement.GetString() ?? "");
                Logger.Log($"=== HandleReadFile === Requested path: '{requestedPath}'");

                if (string.IsNullOrWhiteSpace(requestedPath) || requestedPath.Contains("..") || requestedPath.Contains("~"))
                {
                    Logger.Log($"ERROR: Invalid path '{requestedPath}'");
                    SendErrorResponse(requestId, "Path invalid or not allowed");
                    return;
                }

                string safePath = Path.Combine(_allowedDataDirectory, requestedPath);
                safePath = Path.GetFullPath(safePath);

                if (!safePath.StartsWith(_allowedDataDirectory, StringComparison.OrdinalIgnoreCase) || !File.Exists(safePath))
                {
                    Logger.Log($"File not found: {safePath}");
                    SendResponse(requestId, "FILE_NOT_FOUND");
                    return;
                }

                string content = await File.ReadAllTextAsync(safePath);
                Logger.Log($"SUCCESS: Read {content.Length} chars from {safePath}");
                SendResponse(requestId, content);
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "HandleReadFile");
                SendErrorResponse(requestId, $"Read failed: {ex.Message}");
            }
        }

        private async Task HandleDeleteFile(string requestId, JsonElement root)
        {
            try
            {
                if (!root.TryGetProperty("path", out var pathElement))
                {
                    Logger.Log("ERROR: Missing path in DeleteFile");
                    SendErrorResponse(requestId, "Missing path");
                    return;
                }

                string requestedPath = Path.GetFileName(pathElement.GetString() ?? "");
                Logger.Log($"=== HandleDeleteFile === Requested path: '{requestedPath}'");

                if (string.IsNullOrWhiteSpace(requestedPath) || requestedPath.Contains("..") || requestedPath.Contains("~"))
                {
                    Logger.Log($"ERROR: Invalid path '{requestedPath}'");
                    SendErrorResponse(requestId, "Path invalid or not allowed");
                    return;
                }

                string safePath = Path.Combine(_allowedDataDirectory, requestedPath);
                safePath = Path.GetFullPath(safePath);

                if (!safePath.StartsWith(_allowedDataDirectory, StringComparison.OrdinalIgnoreCase))
                {
                    Logger.Log($"SECURITY ERROR: Path escaped data directory: {safePath}");
                    SendErrorResponse(requestId, "Path not allowed");
                    return;
                }

                if (File.Exists(safePath))
                {
                    File.Delete(safePath);
                    Logger.Log($"SUCCESS: File deleted: {safePath}");
                    SendResponse(requestId, true);
                }
                else
                {
                    Logger.Log($"File not found for deletion: {safePath}");
                    SendResponse(requestId, false);
                }
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "HandleDeleteFile");
                SendErrorResponse(requestId, $"Delete failed: {ex.Message}");
            }
        }

        private async Task HandleListDir(string requestId, JsonElement root)
        {
            try
            {
                string requestedPath = root.TryGetProperty("path", out var pathElement)
                    ? Path.GetFileName(pathElement.GetString() ?? "")
                    : "";

                Logger.Log($"=== HandleListDir === Requested path: '{requestedPath}'");

                if (requestedPath.Contains("..") || requestedPath.Contains("~"))
                {
                    Logger.Log($"ERROR: Invalid path '{requestedPath}'");
                    SendErrorResponse(requestId, "Path traversal not allowed");
                    return;
                }

                string safePath = Path.Combine(_allowedDataDirectory, requestedPath);
                safePath = Path.GetFullPath(safePath);

                if (!safePath.StartsWith(_allowedDataDirectory, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(safePath))
                {
                    Logger.Log($"Directory not found: {safePath}");
                    SendResponse(requestId, Array.Empty<string>());
                    return;
                }

                var files = Directory.GetFiles(safePath)
                    .Select(Path.GetFileName)
                    .Where(name => name != null)
                    .ToArray()!;

                Logger.Log($"SUCCESS: Found {files.Length} files in {safePath}");
                SendResponse(requestId, files);
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "HandleListDir");
                SendErrorResponse(requestId, $"List failed: {ex.Message}");
            }
        }

        private void SendResponse(string id, object payload)
        {
            try
            {
                var response = new { id = id, data = payload };
                string jsonResponse = JsonSerializer.Serialize(response);
                Logger.Log($"Sending response: {jsonResponse}");
                MyWebView?.CoreWebView2?.PostWebMessageAsJson(jsonResponse);
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "SendResponse");
            }
        }

        private void SendErrorResponse(string id, string error)
        {
            try
            {
                var response = new { id = id, error = error };
                string jsonResponse = JsonSerializer.Serialize(response);
                Logger.Log($"Sending ERROR response: {jsonResponse}");
                MyWebView?.CoreWebView2?.PostWebMessageAsJson(jsonResponse);
            }
            catch (Exception ex)
            {
                Logger.LogException(ex, "SendErrorResponse");
            }
        }
    }
}
