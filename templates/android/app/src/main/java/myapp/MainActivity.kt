package com.example.myapplication
import java.io.File
import java.io.BufferedWriter
import android.app.AlertDialog
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Message
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import java.io.FileNotFoundException
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : ComponentActivity() {

    lateinit var webView: WebView
    lateinit var androidBridge: AndroidBridge

    private val baseUrl = "file:///android_asset/myapp/index.html"

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        // --- WebView Settings ---
        webView.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false

            // Basic compatibility settings
            setSupportMultipleWindows(false)
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportZoom(true)

            // Performance optimizations
            javaScriptCanOpenWindowsAutomatically = false
            loadsImagesAutomatically = true
        }

        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.requestFocus()

        // --- JS Bridge ---
        androidBridge = AndroidBridge(this, webView, baseUrl)
        webView.addJavascriptInterface(androidBridge, "Android")

        // --- WebViewClient ---
        webView.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return if (url != null && url.startsWith(baseUrl)) {
                    false
                } else {
                    Toast.makeText(
                        this@MainActivity,
                        "Blocked external navigation",
                        Toast.LENGTH_SHORT
                    ).show()
                    true
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                view?.evaluateJavascript(
                    "console.log('Android bridge ready:', !!window.Android)",
                    null
                )
            }
        }

        // --- Block popups ---
        webView.webChromeClient = object : WebChromeClient() {
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message?
            ): Boolean = false
        }

        // --- Back button → JS ---
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "window.onNativeKey && window.onNativeKey(4)",
                    null
                )
            }
        })

        webView.loadUrl(baseUrl)
    }

    // --- Permission result forwarding ---
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        androidBridge.onPermissionResult(requestCode, grantResults)
    }

    // --- DPAD / media keys ---
    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            val handled = when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_UP,
                KeyEvent.KEYCODE_DPAD_DOWN,
                KeyEvent.KEYCODE_DPAD_LEFT,
                KeyEvent.KEYCODE_DPAD_RIGHT,
                KeyEvent.KEYCODE_DPAD_CENTER,
                KeyEvent.KEYCODE_BACK,
                KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                    webView.post {
                        webView.evaluateJavascript(
                            "window.onNativeKey && window.onNativeKey(${event.keyCode})",
                            null
                        )
                    }
                    true
                }
                else -> false
            }
            if (handled) return true
        }
        return super.dispatchKeyEvent(event)
    }
}

// ---------------- JS BRIDGE ----------------

class AndroidBridge(
    private val activity: ComponentActivity,
    private val webView: WebView,
    private val baseUrl: String
) {

    private val PERMISSION_REQUEST_CODE = 9001

    // ---- Toast ----
    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

   // ---- File System Methods ----
@JavascriptInterface
fun writeFile(path: String, content: String): Boolean {
    return try {
        // Create directories if needed
        val file = File(activity.filesDir, path)
        file.parentFile?.mkdirs()
        
        file.bufferedWriter().use { writer ->
            writer.write(content)
        }
        true
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

@JavascriptInterface
fun readFile(path: String): String {
    return try {
        val file = File(activity.filesDir, path)
        if (!file.exists()) {
            return "{\"error\":\"File not found\"}"
        }
        file.bufferedReader().use { it.readText() }
    } catch (e: Exception) {
        e.printStackTrace()
        "{\"error\":\"${e.message}\"}"
    }
}

@JavascriptInterface
fun deleteFile(path: String): Boolean {
    return try {
        val file = File(activity.filesDir, path)
        file.delete()
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

@JavascriptInterface
fun listFiles(path: String = ""): String {
    return try {
        val dir = File(activity.filesDir, path)
        val files = if (dir.exists() && dir.isDirectory) {
            dir.list()?.toList() ?: emptyList()
        } else {
            emptyList()
        }
        JSONArray(files).toString()
    } catch (e: Exception) {
        e.printStackTrace()
        "[]"
    }
}
 
    // ---- Permissions ----
    @JavascriptInterface
    fun hasPermission(name: String): Boolean {
        val permissions = mapPermission(name)
        return permissions.all {
            ContextCompat.checkSelfPermission(activity, it) ==
                    PackageManager.PERMISSION_GRANTED
        }
    }

    @JavascriptInterface
    fun requestPermission(name: String) {
        val permissions = mapPermission(name)

        if (permissions.isEmpty()) {
            sendPermissionResult(true)
            return
        }

        val granted = permissions.all {
            ContextCompat.checkSelfPermission(activity, it) ==
                    PackageManager.PERMISSION_GRANTED
        }

        if (granted) {
            sendPermissionResult(true)
            return
        }

        ActivityCompat.requestPermissions(
            activity,
            permissions,
            PERMISSION_REQUEST_CODE
        )
    }

    fun onPermissionResult(requestCode: Int, grantResults: IntArray) {
        if (requestCode != PERMISSION_REQUEST_CODE) return
        val granted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        sendPermissionResult(granted)
    }

    private fun sendPermissionResult(granted: Boolean) {
        webView.post {
            webView.evaluateJavascript(
                "window.onNativePermissionResult && window.onNativePermissionResult($granted)",
                null
            )
        }
    }

    // ---- Dialog ----
    @JavascriptInterface
    fun showDialog(
        title: String,
        message: String,
        okText: String = "OK",
        cancelText: String = "Cancel"
    ) {
        activity.runOnUiThread {
            AlertDialog.Builder(activity)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton(okText) { _, _ ->
                    webView.evaluateJavascript(
                        "window.onNativeDialogResult && window.onNativeDialogResult(true)",
                        null
                    )
                }
                .setNegativeButton(cancelText) { _, _ ->
                    webView.evaluateJavascript(
                        "window.onNativeDialogResult && window.onNativeDialogResult(false)",
                        null
                    )
                }
                .setCancelable(false)
                .show()
        }
    }

    // ---- Native fetch ----
    @JavascriptInterface
    fun nativeFetch(url: String, method: String): String {
        return try {
            val connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = method
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            val response = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()
            response
        } catch (e: Exception) {
            "{\"error\":\"${e.message}\"}"
        }
    }

    // ---- Navigation ----
    @JavascriptInterface
    fun navigate(path: String?) {
        val clean = path?.trimStart('/') ?: ""
        webView.post {
            val finalUrl = "$baseUrl$clean/index.html".replace("//index", "/index")
            webView.loadUrl(finalUrl)
        }
    }

    // ---- Permission map ----
    private fun mapPermission(name: String): Array<String> {
        return when (name) {
            "storage" -> arrayOf(
                android.Manifest.permission.READ_EXTERNAL_STORAGE,
                android.Manifest.permission.WRITE_EXTERNAL_STORAGE
            )
            "camera" -> arrayOf(android.Manifest.permission.CAMERA)
            "microphone" -> arrayOf(android.Manifest.permission.RECORD_AUDIO)
            "notifications" -> arrayOf(android.Manifest.permission.POST_NOTIFICATIONS)
            else -> emptyArray()
        }
    }
}