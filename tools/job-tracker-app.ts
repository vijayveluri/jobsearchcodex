import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { delimiter, dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { inflateRawSync } from "node:zlib"
import { existsSync } from "node:fs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const appDir = join(repoRoot, "app")
const dataFile = join(repoRoot, "data", "job-tracker.json")
const profileFile = join(repoRoot, "data", "candidate-profile.json")
const resumeFile = join(repoRoot, "data", "resume-source")
const cliFile = join(repoRoot, ".agents", "skills", "freehire-search", "cli", "src", "cli.ts")
const allowedStatuses = ["Saved", "Preparing", "Applied", "Interview", "Hired", "Rejected"] as const
type Status = (typeof allowedStatuses)[number]
const legacyStatusMap: Record<string, Status> = { Responded: "Applied", Offer: "Interview", Withdrawn: "Rejected" }
function normalizeStatus(value: unknown): Status {
  if (typeof value !== "string") return "Saved"
  if (allowedStatuses.includes(value as Status)) return value as Status
  return legacyStatusMap[value] || "Saved"
}

type TrackedJob = {
  id: string
  title: string
  company: string
  location: string
  date: string | null
  url: string
  description: string
  sourcePortals?: string[]
  status: Status
  notes: string
  resumeDraft?: string
  coverLetterDraft?: string
  createdAt: string
  updatedAt: string
  activity: Array<{ at: string; text: string }>
}

type CandidateProfile = { resumeName: string; uploadedAt: string | null; resumeText: string }
const emptyProfile: CandidateProfile = { resumeName: "", uploadedAt: null, resumeText: "" }
let jobsWriteQueue: Promise<void> = Promise.resolve()

const json = (data: unknown, status = 200) => Response.json(data, { status })
const now = () => new Date().toISOString()

async function readJobs(): Promise<TrackedJob[]> {
  try {
    const jobs = JSON.parse(await readFile(dataFile, "utf8")) as TrackedJob[]
    return jobs.map((job) => ({ ...job, status: normalizeStatus(job.status) }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function writeJobs(jobs: TrackedJob[]) {
  const contents = `${JSON.stringify(jobs, null, 2)}\n`
  const write = jobsWriteQueue.then(async () => {
    await mkdir(dirname(dataFile), { recursive: true })
    const tempFile = `${dataFile}.${randomUUID()}.tmp`
    await writeFile(tempFile, contents, "utf8")
    try {
      let lastError: unknown
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await rename(tempFile, dataFile); return }
        catch (error) {
          lastError = error
          const code = (error as NodeJS.ErrnoException).code
          if (!["EPERM", "EEXIST", "EBUSY"].includes(code || "") || attempt === 3) break
          await Bun.sleep(100 * (attempt + 1))
        }
      }
      // Windows can briefly deny replacing an existing file (for example while
      // an antivirus scanner has it open). Fall back to an in-place write.
      try { await writeFile(dataFile, contents, "utf8") }
      catch { throw lastError }
    } finally {
      await rm(tempFile, { force: true }).catch(() => {})
    }
  })
  jobsWriteQueue = write.catch(() => {})
  await write
}

async function readProfile(): Promise<CandidateProfile> {
  try {
    return { ...emptyProfile, ...JSON.parse(await readFile(profileFile, "utf8")) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyProfile
    throw error
  }
}

async function writeProfile(profile: CandidateProfile) {
  await mkdir(dirname(profileFile), { recursive: true })
  await writeFile(profileFile, `${JSON.stringify(profile, null, 2)}\n`, "utf8")
}

function extractDocxText(zip: Buffer): string {
  const endMin = Math.max(0, zip.length - 65_557)
  let end = -1
  for (let i = zip.length - 22; i >= endMin; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new Error("This .docx file does not look like a valid Word document.")
  const count = zip.readUInt16LE(end + 10)
  let offset = zip.readUInt32LE(end + 16)
  let xml: Buffer | undefined
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("The Word document archive is damaged.")
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const uncompressedSize = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength)
    if (name === "word/document.xml") {
      if (uncompressedSize > 20_000_000) throw new Error("The document text is unusually large to process safely.")
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("The Word document archive is damaged.")
      const localNameLength = zip.readUInt16LE(localOffset + 26)
      const localExtraLength = zip.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const compressed = zip.subarray(start, start + compressedSize)
      if (method === 0) xml = compressed
      else if (method === 8) xml = inflateRawSync(compressed, { maxOutputLength: 20_000_000 })
      else throw new Error("This Word document uses an unsupported compression format.")
      break
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  if (!xml) throw new Error("Could not find the main text in this Word document.")
  const source = xml.toString("utf8")
  const paragraphs = source.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []
  const decode = (text: string) => text.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  return paragraphs.map((paragraph) => {
    const texts = [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => decode(match[1]))
    return texts.join("")
  }).filter(Boolean).join("\n").replace(/[ \t]+\n/g, "\n").trim()
}

async function extractResume(file: File): Promise<string> {
  const extension = extname(file.name).toLowerCase()
  if (![".docx", ".txt", ".md"].includes(extension)) throw new Error("Upload a Word document (.docx) or text file (.txt or .md). For PDF, save or export it as .docx first.")
  if (file.size === 0 || file.size > 10_000_000) throw new Error("Choose a resume file under 10 MB.")
  const bytes = Buffer.from(await file.arrayBuffer())
  let text = extension === ".docx" ? extractDocxText(bytes) : new TextDecoder("utf-8").decode(bytes)
  text = text.replace(/\r/g, "").replace(/[\t ]+\n/g, "\n").trim()
  if (!text) throw new Error("No readable text was found. Try uploading a text-based Word document.")
  return text.slice(0, 100_000)
}

function safeFolderName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "job"
}

function applicationDir(jobId: string) {
  return join(repoRoot, "documents", "applications", safeFolderName(jobId))
}

function findTexEngine(engine: "lualatex" | "xelatex"): string | null {
  const executable = process.platform === "win32" ? `${engine}.exe` : engine
  const candidates = (process.env.PATH || "").split(delimiter).map((dir) => join(dir, executable))
  const local = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles
  if (local) candidates.push(join(local, "Programs", "MiKTeX", "miktex", "bin", "x64", executable))
  if (programFiles) candidates.push(join(programFiles, "MiKTeX", "miktex", "bin", "x64", executable))
  return candidates.find((candidate) => existsSync(candidate)) || null
}

async function compileTex(engine: "lualatex" | "xelatex", texPath: string, workingDirectory: string, outputDirectory: string) {
  const executable = findTexEngine(engine)
  if (!executable) throw new Error(`${engine} was not found. Add your LaTeX distribution's binary folder to PATH, then restart the app.`)
  const child = Bun.spawn([executable, "-interaction=nonstopmode", "-halt-on-error", `-output-directory=${outputDirectory}`, texPath], {
    cwd: workingDirectory, stdout: "pipe", stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) {
    const log = `${stdout}\n${stderr}`.trim().split(/\r?\n/).slice(-24).join("\n")
    throw new Error(`${engine} could not compile this draft. Review the LaTeX source.\n${log}`)
  }
}

async function searchJobs(body: Record<string, unknown>) {
  const query = typeof body.query === "string" ? body.query.trim() : ""
  const city = typeof body.city === "string" ? body.city.trim() : ""
  const region = typeof body.region === "string" ? body.region.trim() : ""
  const age = Math.min(3650, Math.max(1, Number(body.jobAge) || 30))
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 20))
  const country = typeof body.country === "string" ? body.country.trim() : "India"
  if (!query) return json({ error: "Enter a job title or search phrase." }, 400)
  if (city && region) return json({ error: "Choose a city or a region, not both." }, 400)

  const providers: Array<{ name: string; run: () => Promise<Record<string, unknown>[]> }> = []
  providers.push({ name: "FreeHire", run: async () => {
    const args = ["run", cliFile, "search", "-q", query, "--jobage", String(age), "--limit", String(limit), "--description-format", "text", "--format", "json"]
    if (city) args.push("--city", city)
    if (region) args.push("--region", region)
    const child = Bun.spawn([process.execPath, ...args], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (exitCode !== 0) throw new Error(stderr.trim() || "FreeHire search failed.")
    const payload = JSON.parse(stdout) as { results?: Record<string, unknown>[] }
    return (payload.results || []).map((job) => ({ ...job, sourcePortals: ["FreeHire"] }))
  } })

  if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY && city && country === "India") providers.push({ name: "Adzuna", run: async () => {
    const params = new URLSearchParams({ app_id: process.env.ADZUNA_APP_ID!, app_key: process.env.ADZUNA_APP_KEY!, what: query, where: city, max_days_old: String(age), results_per_page: String(limit), "content-type": "application/json" })
    const response = await fetch("https://api.adzuna.com/v1/api/jobs/in/search/1?" + params)
    if (!response.ok) throw new Error("Adzuna returned HTTP " + response.status)
    const payload = await response.json() as { results?: Array<Record<string, any>> }
    return (payload.results || []).map((job) => ({ id: "adzuna:" + String(job.id), title: job.title, company: job.company?.display_name || "Company not listed", location: job.location?.display_name || city, date: job.created || null, url: job.redirect_url, description: job.description || "", sourcePortals: ["Adzuna"] }))
  } })

  if (process.env.JOOBLE_APIS) {
    try {
      const joobleApis = JSON.parse(process.env.JOOBLE_APIS) as Array<{ name?: string; baseUrl: string; apiKey: string; country?: string }>
      for (const config of joobleApis) {
        if (!config?.baseUrl || !config.apiKey) continue
        if (city && config.country && config.country.toLowerCase() !== country.toLowerCase()) continue
        if (region.toLowerCase() === "mena" && config.country?.toLowerCase() === "india") continue
        providers.push({ name: config.name || "Jooble", run: async () => {
          const location = city || config.country || region || ""
          const response = await fetch(config.baseUrl.replace(/\/$/, "") + "/" + encodeURIComponent(config.apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keywords: query, location, page: "1", ResultOnPage: String(limit), companysearch: false }) })
          if (!response.ok) throw new Error("Jooble returned HTTP " + response.status)
          const payload = await response.json() as { jobs?: Array<Record<string, any>> }
          return (payload.jobs || []).map((job) => ({ id: "jooble:" + String(job.id), title: job.title, company: job.company || "Company not listed", location: job.location || location, date: job.updated || null, url: job.link, description: job.snippet || "", sourcePortals: ["Jooble"] }))
        } })
      }
    } catch { return json({ error: "JOOBLE_APIS must be a JSON array of configured Jooble API endpoints and keys." }, 500) }
  }

  const settled = await Promise.allSettled(providers.map((provider) => provider.run()))
  const results: Record<string, any>[] = [], byKey = new Map<string, Record<string, any>>(), warnings: string[] = []
  settled.forEach((result, index) => {
    const provider = providers[index]
    if (result.status === "rejected") { warnings.push(provider.name + ": " + String(result.reason)); return }
    for (const job of result.value) {
      if (typeof job.url !== "string" || !/^https?:\/\//i.test(job.url)) continue
      const key = [job.title, job.company, job.location].map((value) => String(value || "").trim().toLowerCase()).join("|")
      const existing = byKey.get(key)
      if (existing) existing.sourcePortals = [...new Set([...(existing.sourcePortals || []), ...(job.sourcePortals || [])])]
      else { byKey.set(key, job); results.push(job) }
    }
  })
  if (!results.length && warnings.length) return json({ error: warnings.join(" · ") }, 502)
  try {
    return json({ results, sources: providers.map((provider) => provider.name), warnings })
  } catch {
    return json({ error: "The combined job search could not be returned." }, 502)
  }
}

const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" }

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT) || 4177,
  async fetch(request) {
    const url = new URL(request.url)
    try {
      if (url.pathname === "/api/health") return json({ ok: true })
      if (url.pathname === "/api/search" && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as Record<string, unknown>
        return await searchJobs(body)
      }
      if (url.pathname === "/api/profile" && request.method === "GET") return json(await readProfile())
      if (url.pathname === "/api/profile" && request.method === "PUT") {
        const body = await request.json() as Record<string, unknown>
        const profile: CandidateProfile = { ...await readProfile(), resumeText: typeof body.resumeText === "string" ? body.resumeText.slice(0, 100_000) : "" }
        await writeProfile(profile)
        return json(profile)
      }
      if (url.pathname === "/api/profile/resume" && request.method === "POST") {
        const form = await request.formData()
        const file = form.get("resume")
        if (!(file instanceof File)) return json({ error: "Choose a resume file to upload." }, 400)
        let resumeText: string
        try { resumeText = await extractResume(file) }
        catch (error) { return json({ error: error instanceof Error ? error.message : "Could not read this resume." }, 400) }
        await mkdir(dirname(resumeFile), { recursive: true })
        await writeFile(resumeFile, Buffer.from(await file.arrayBuffer()))
        const profile: CandidateProfile = { resumeName: file.name.replace(/[\\/]/g, "_").slice(0, 180), uploadedAt: now(), resumeText }
        await writeProfile(profile)
        return json(profile)
      }
      if (url.pathname === "/api/jobs" && request.method === "GET") return json(await readJobs())
      if (url.pathname === "/api/jobs" && request.method === "POST") {
        const job = await request.json() as Record<string, unknown>
        if (typeof job.id !== "string" || typeof job.url !== "string" || !/^https?:\/\//i.test(job.url)) {
          return json({ error: "This listing is missing a valid posting link." }, 400)
        }
        const jobs = await readJobs()
        if (jobs.some((existing) => existing.id === job.id)) return json({ error: "This job is already in your tracker." }, 409)
        const timestamp = now()
        const saved: TrackedJob = {
          id: job.id,
          title: String(job.title || "Untitled role"),
          company: String(job.company || "Company not listed"),
          location: String(job.location || "Location not listed"),
          date: typeof job.date === "string" ? job.date : null,
          url: job.url,
          description: String(job.description || ""),
          sourcePortals: Array.isArray(job.sourcePortals) ? job.sourcePortals.filter((source): source is string => typeof source === "string").slice(0, 8) : ["FreeHire"],
          status: allowedStatuses.includes(job.status as Status) ? job.status as Status : "Saved",
          notes: "",
          createdAt: timestamp,
          updatedAt: timestamp,
          activity: [
            { at: timestamp, text: "Added to tracker" },
            ...(job.status && job.status !== "Saved" ? [{ at: timestamp, text: `Status changed to ${String(job.status)}` }] : []),
          ],
        }
        jobs.unshift(saved)
        await writeJobs(jobs)
        return json(saved, 201)
      }
      const match = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)
      if (match && request.method === "PATCH") {
        const id = decodeURIComponent(match[1])
        const jobs = await readJobs()
        const job = jobs.find((item) => item.id === id)
        if (!job) return json({ error: "Job not found." }, 404)
        const body = await request.json() as Record<string, unknown>
        const events: string[] = []
        if (typeof body.status === "string" && allowedStatuses.includes(body.status as Status) && body.status !== job.status) {
          job.status = body.status as Status
          events.push(`Status changed to ${job.status}`)
        }
        if (typeof body.notes === "string" && body.notes !== job.notes) {
          job.notes = body.notes.slice(0, 8000)
          events.push("Notes updated")
        }
        if (typeof body.resumeDraft === "string" && body.resumeDraft !== job.resumeDraft) {
          job.resumeDraft = body.resumeDraft.slice(0, 50000)
          events.push("Resume draft saved")
        }
        if (typeof body.coverLetterDraft === "string" && body.coverLetterDraft !== job.coverLetterDraft) {
          job.coverLetterDraft = body.coverLetterDraft.slice(0, 20000)
          events.push("Cover letter draft saved")
        }
        if (events.length) {
          job.updatedAt = now()
          job.activity.push(...events.map((text) => ({ at: job.updatedAt, text })))
          await writeJobs(jobs)
        }
        return json(job)
      }
      const documentsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/documents(?:\/(resume\.tex|cover-letter\.tex|resume\.pdf|cover-letter\.pdf|compile))?$/)
      if (documentsMatch) {
        const id = decodeURIComponent(documentsMatch[1])
        const jobs = await readJobs()
        const job = jobs.find((item) => item.id === id)
        if (!job) return json({ error: "Job not found." }, 404)
        const dir = applicationDir(job.id)
        if (request.method === "POST" && !documentsMatch[2]) {
          const body = await request.json() as Record<string, unknown>
          if (typeof body.resumeTex !== "string" || typeof body.coverLetterTex !== "string" || body.resumeTex.length > 200_000 || body.coverLetterTex.length > 100_000) {
            return json({ error: "The LaTeX sources are missing or too large." }, 400)
          }
          await mkdir(dir, { recursive: true })
          await writeFile(join(dir, "resume.tex"), body.resumeTex, "utf8")
          await writeFile(join(dir, "cover-letter.tex"), body.coverLetterTex, "utf8")
          job.resumeDraft = body.resumeTex
          job.coverLetterDraft = body.coverLetterTex
          job.updatedAt = now()
          job.activity.push({ at: job.updatedAt, text: "LaTeX resume and cover-letter sources generated" })
          await writeJobs(jobs)
          return json({ saved: true })
        }
        if (request.method === "POST" && documentsMatch[2] === "compile") {
          const resumePath = join(dir, "resume.tex")
          const letterPath = join(dir, "cover-letter.tex")
          if (!existsSync(resumePath) || !existsSync(letterPath)) return json({ error: "Generate and save the LaTeX drafts first." }, 400)
          await mkdir(dir, { recursive: true })
          try {
            await compileTex("lualatex", resumePath, join(repoRoot, "cv"), dir)
            await compileTex("xelatex", letterPath, join(repoRoot, "cover_letters"), dir)
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : "LaTeX compilation failed." }, 500)
          }
          job.updatedAt = now()
          job.activity.push({ at: job.updatedAt, text: "LaTeX resume and cover-letter PDFs compiled" })
          await writeJobs(jobs)
          return json({ resume: "resume.pdf", coverLetter: "cover-letter.pdf" })
        }
        if (request.method === "GET" && documentsMatch[2] && documentsMatch[2] !== "compile") {
          const filename = documentsMatch[2]
          const companyPrefix = job.company.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company"
          const downloadName = `${companyPrefix}-${filename}`
          const file = join(dir, filename)
          const contents = await readFile(file).catch(() => null)
          if (!contents) return json({ error: "That file has not been generated yet." }, 404)
          return new Response(contents, { headers: {
            "Content-Type": filename.endsWith(".pdf") ? "application/pdf" : "application/x-tex; charset=utf-8",
            "Content-Disposition": filename.endsWith(".pdf") && url.searchParams.get("download") !== "1" ? "inline" : `attachment; filename="${downloadName}"`,
          } })
        }
      }
      if (request.method === "GET") {
        const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1))
        const file = resolve(appDir, relative)
        if (file !== appDir && !file.startsWith(`${appDir}${sep}`)) return new Response("Not found", { status: 404 })
        const data = await readFile(file).catch(() => null)
        if (!data) return new Response("Not found", { status: 404 })
        return new Response(data, { headers: { "Content-Type": contentTypes[extname(file)] || "application/octet-stream" } })
      }
      return json({ error: "Not found." }, 404)
    } catch (error) {
      console.error(error)
      return json({ error: "Something went wrong. Check the app terminal for details." }, 500)
    }
  },
})

console.log(`Job tracker running at http://127.0.0.1:${Number(process.env.PORT) || 4177}`)
console.log("Your saved jobs stay in this repository's ignored data/job-tracker.json file.")
