
import fs from "fs/promises";
import path from "path";

const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".txt": "text/plain",
    ".xml": "application/xml"
};

async function getFiles(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, {
        withFileTypes: true
    });

    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...await getFiles(fullPath));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }

    return files;
}

export async function generateResources(
    distDir: string,
    projectDir: string
) {
    const files = await getFiles(distDir);

    const declarations: string[] = [];
    const entries: string[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const relativePath = path.relative(
            distDir,
            file
        ).split(path.sep).join("/");

        const buffer = await fs.readFile(file);

        const identifier = `resource_${i}`;

        const bytes = Array.from(buffer)
            .map(byte => `0x${byte.toString(16).padStart(2, "0")}`)
            .join(",");

        const extension = path.extname(file).toLowerCase();

        const mimeType =
            mimeTypes[extension] || "application/octet-stream";

        declarations.push(`
static const unsigned char ${identifier}[] = {
    ${bytes}
};
`);

        entries.push(`
{
    "${relativePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}",
    { ${identifier}, sizeof(${identifier}), "${mimeType}" }
}
`);
    }

    const header = `#pragma once

#include <cstddef>
#include <string_view>

struct EmbeddedResource {
    const unsigned char* data;
    std::size_t size;
    const char* mimeType;
};

const EmbeddedResource* findResource(std::string_view path);
`;

    const source = `#include "resources.h"

#include <unordered_map>
#include <string>

${declarations.join("\n")}

static const std::unordered_map<std::string, EmbeddedResource> resources = {
    ${entries.join(",\n")}
};

const EmbeddedResource* findResource(std::string_view path) {
    while (!path.empty() && path.front() == '/') {
        path.remove_prefix(1);
    }

    auto it = resources.find(std::string(path));

    if (it == resources.end()) {
        return nullptr;
    }

    return &it->second;
}
`;

    await fs.writeFile(
        path.join(projectDir, "resources.h"),
        header
    );

    await fs.writeFile(
        path.join(projectDir, "resources.cpp"),
        source
    );

    console.log(`Embedded ${files.length} frontend files.`);
}
