import type { MountedSession } from "@opencode/plugin/gui"
import type { SessionPromptInput } from "@opencode/client"

export const INLINE_BYTES = 20 * 1024 * 1024
export type Upload = { id: string; file: File }

function fileUri(directory: string, path: string) {
  const absolute = path.startsWith("/") ? path : `${directory.replace(/\/$/, "")}/${path}`
  return `file://${absolute.split("/").map(encodeURIComponent).join("/")}`
}

export function pathAttachment(directory: string, path: string): NonNullable<SessionPromptInput["files"]>[number] {
  return { uri: fileUri(directory, path), name: path }
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error(`Couldn’t read ${file.name}`))
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn’t read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export async function prepareFiles(
  session: MountedSession,
  mentions: readonly string[],
  uploads: readonly Upload[],
  modalities: readonly string[],
  signal: AbortSignal,
) {
  const files = mentions.map(path => pathAttachment(session.directory, path))
  const client = session.server.client
  let tmp: string | undefined
  let inlineBytes = 0

  for (const { id, file } of uploads) {
    const mime = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "")
    const modality = mime === "application/pdf" ? "pdf" : mime.split("/")[0]
    if (["image", "pdf", "audio", "video"].includes(modality) &&
      modalities.includes(modality) && inlineBytes + file.size <= INLINE_BYTES) {
      const blob = mime === file.type ? file : new File([file], file.name, { type: mime })
      files.push({ uri: await readDataUrl(blob), name: file.name })
      inlineBytes += file.size
      continue
    }

    tmp ??= (await client.server.info({ signal })).paths.tmp
    const name = file.name.replace(/[/\\]/g, "_")
    const output = await client.file.write({
      location: session.location,
      path: `${tmp}/uploads/${id}/${name}`,
      payload: new Uint8Array(await file.arrayBuffer()),
    }, { signal })
    files.push({ ...pathAttachment(session.directory, output.data.path), name: file.name })
  }

  return files
}
