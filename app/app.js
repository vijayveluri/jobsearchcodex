const $ = (selector, root = document) => root.querySelector(selector)
let trackedJobs = []
let candidateProfile = {}
const searchStorageKey = "my-job-tracker-search-v1"
const keywords = ["OCI", "Oracle Cloud", "Fusion", "WebLogic", "Kubernetes", "K8s", "DevOps", "AIOps", "SRE", "Site Reliability", "AWS", "Azure", "GCP", "Terraform", "Ansible", "Jenkins", "Docker", "Linux", "Prometheus", "Grafana", "OpenShift", "Java", "Python", "CI/CD"]
function setMessage(text, error = false) { const target = $("#search-message"); target.textContent = text; target.classList.toggle("error", error) }
async function api(path, options = {}) { const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } }); const data = await response.json(); if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`); return data }
function preview(text) { const normalized = String(text || "Description not provided by the source.").replace(/\s+/g, " ").trim(); return normalized.length > 300 ? `${normalized.slice(0, 300).trimEnd()}…` : normalized }
function formatDate(value) { if (!value || value === "—") return "Date not listed"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : `Posted ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` }
function matchLevel(job) {
  const resume = String(candidateProfile.resumeText || "").toLowerCase()
  if (!resume.trim()) return { label: "Upload resume to score", cls: "match-unscored" }
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase()
  const terms = keywords.filter((term) => text.includes(term.toLowerCase()))
  const matched = terms.filter((term) => resume.includes(term.toLowerCase()))
  const ratio = terms.length ? matched.length / terms.length : 0
  const level = ratio >= 0.65 && matched.length >= 3 ? "High" : ratio >= 0.3 && matched.length >= 2 ? "Medium" : "Low"
  return { label: `${level} match`, cls: `match-${level.toLowerCase()}`, title: `${matched.length} of ${terms.length} recognized job keywords appear in the uploaded resume. This is an estimate, not a hiring prediction.` }
}
const appliedStatuses = ["Applied", "Interview", "Hired", "Rejected"]
function updateTrackedState(card, job) {
  const current = trackedJobs.find((item) => item.id === job.id)
  const button = $(".track-button", card), status = $(".tracked-status", card)
  if (!current) { button.disabled = false; button.textContent = "Track this job"; status.classList.add("hidden"); return }
  button.disabled = true; button.textContent = "Tracked"
  const label = current.status === "Applied" || appliedStatuses.includes(current.status) ? current.status : "Tracked"
  status.textContent = label; status.className = `tracked-status ${appliedStatuses.includes(current.status) ? "is-applied" : "is-tracked"}`
}
function renderSearchResult(job) {
  const card = $("#job-card-template").content.firstElementChild.cloneNode(true)
  card.dataset.jobId = job.id
  $(".job-company", card).textContent = job.company || "Company not listed"
  $(".source-pill", card).textContent = (job.sourcePortals || ["FreeHire"]).join(" · ")
  $(".job-title", card).textContent = job.title || "Untitled role"
  $(".job-meta", card).textContent = job.location || "Location not listed"
  $(".job-date", card).textContent = formatDate(job.date)
  $(".description-preview", card).textContent = preview(job.description)
  $(".description-full", card).textContent = job.description || "Description not provided by the source."
  const pill = $(".match-pill", card), match = matchLevel(job)
  pill.textContent = match.label; pill.className = `match-pill ${match.cls}`; pill.title = match.title || "Upload a resume in My Profile to estimate keyword overlap."
  const existing = trackedJobs.find((item) => item.id === job.id)
  const track = $(".track-button", card)
  track.addEventListener("click", async () => {
    track.disabled = true; track.textContent = "Tracking…"
    try {
      await api("/api/jobs", { method: "POST", body: JSON.stringify({ ...job, status: "Saved" }) })
      trackedJobs = await api("/api/jobs"); updateStats(); updateTrackedState(card, job)
      setMessage(`${job.title || "Job"} added to Application Tracker.`)
    } catch (error) { track.disabled = false; track.textContent = "Track this job"; setMessage(error.message, true) }
  })
  updateTrackedState(card, job)
  return card
}
function updateStats() {
  const laterStages = { Interview: ["Hired"] }
  const reached = (job, stage) => job.status === stage || (laterStages[stage] || []).includes(job.status) || (job.activity || []).some((event) => event.text === `Status changed to ${stage}`)
  $("#stat-tracked").textContent = trackedJobs.length
  $("#stat-progress").textContent = trackedJobs.filter((job) => ["Applied", "Interview", "Hired", "Rejected"].includes(job.status)).length
  $("#stat-interviews").textContent = trackedJobs.filter((job) => reached(job, "Interview")).length
  $("#stat-hired").textContent = trackedJobs.filter((job) => job.status === "Hired").length
}
$("#location-mode").addEventListener("change", (event) => { const isCity = event.target.value === "city"; $("#city-field").classList.toggle("hidden", !isCity); $("#country-field").classList.toggle("hidden", !isCity); $("#region-field").classList.toggle("hidden", isCity) })
function renderResults(results) {
  const target = $("#results"); target.replaceChildren()
  if (!results.length) target.innerHTML = '<div class="empty-state compact"><p>No listings matched. Try a broader role title or a different location.</p></div>'
  results.forEach((job) => target.append(renderSearchResult(job)))
}
function restoreSearch() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(searchStorageKey) || "null")
    if (!saved) return
    $("#query").value = saved.query || ""
    $("#location-mode").value = saved.mode || "city"
    $("#location-mode").dispatchEvent(new Event("change"))
    $("#city").value = saved.city || ""
    $("#country").value = saved.country || "India"
    $("#region").value = saved.region || ""
    $("#job-age").value = saved.jobAge || "30"
    renderResults(Array.isArray(saved.results) ? saved.results : [])
    setMessage(saved.message || `${saved.results?.length || 0} saved listings restored.`)
  } catch { sessionStorage.removeItem(searchStorageKey) }
}
// Keep results while navigating between pages in this tab; a manual browser refresh starts a clean search session.
if (performance.getEntriesByType("navigation")[0]?.type === "reload") sessionStorage.removeItem(searchStorageKey)
$("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = $("#search-button"); button.disabled = true; button.innerHTML = "Searching…"; $("#results").replaceChildren(); setMessage("Searching current listings. This may take a moment.")
  const mode = $("#location-mode").value
  try { const query = $("#query").value, city = mode === "city" ? $("#city").value : "", country = $("#country").value, region = mode === "region" ? $("#region").value : "", jobAge = $("#job-age").value; const response = await api("/api/search", { method: "POST", body: JSON.stringify({ query, city, country, region, jobAge, limit: 25 }) }); const jobs = response.results || []; const sources = (response.sources || []).join(", "); const message = `${jobs.length} listing${jobs.length === 1 ? "" : "s"} found${sources ? ` across ${sources}` : ""}.${response.warnings?.length ? ` Some sources were unavailable: ${response.warnings.join("; ")}` : ""}`; sessionStorage.setItem(searchStorageKey, JSON.stringify({ query, city, country, region, mode, jobAge, results: jobs, message })); renderResults(jobs); setMessage(message) }
  catch (error) { setMessage(error.message, true) } button.disabled = false; button.innerHTML = 'Search roles <span>→</span>'
})
async function init() {
  $("#today").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  try { [trackedJobs, candidateProfile] = await Promise.all([api("/api/jobs"), api("/api/profile")]); updateStats(); restoreSearch() } catch (error) { setMessage(error.message, true) }
}
init()
window.addEventListener("pageshow", async () => {
  try {
    trackedJobs = await api("/api/jobs"); updateStats()
    document.querySelectorAll(".job-card[data-job-id]").forEach((card) => updateTrackedState(card, { id: card.dataset.jobId }))
  } catch (error) { setMessage(error.message, true) }
})
