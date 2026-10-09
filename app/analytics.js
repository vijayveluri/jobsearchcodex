const $ = (selector, root = document) => root.querySelector(selector)
const statusNames = ["Saved", "Preparing", "Applied", "Interview", "Hired", "Rejected"]
const progressedStatuses = ["Applied", "Interview", "Hired", "Rejected"]
let jobs = []
let profile = {}
let autoPreparedId = ""

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
function reached(job, stage) {
  const laterStages = {
    Applied: ["Interview", "Hired", "Rejected"],
    Interview: ["Hired"],
  }
  return job.status === stage || (job.activity || []).some((event) => event.text === `Status changed to ${stage}`) || (laterStages[stage] || []).includes(job.status)
}
function renderBar(container, label, count, max, color) {
  const row = document.createElement("div"); row.className = "funnel-row"
  const name = document.createElement("span"); name.textContent = label
  const rail = document.createElement("div"); rail.className = "funnel-rail"
  const bar = document.createElement("div"); bar.className = `funnel-bar ${color}`; bar.style.width = `${max ? Math.max(count ? 2 : 0, count / max * 100) : 0}%`; rail.append(bar)
  const number = document.createElement("strong"); number.textContent = count; row.append(name, rail, number); container.append(row)
}
function renderMetrics() {
  const countStage = (stage) => jobs.filter((job) => reached(job, stage)).length
  const appliedCount = jobs.filter((job) => progressedStatuses.includes(job.status) || (job.activity || []).some((event) => event.text === "Status changed to Applied")).length
  const respondedCount = countStage("Responded"), interviewCount = countStage("Interview"), offerCount = countStage("Offer"), hiredCount = countStage("Hired")
  // Set the headline values first so a chart/detail rendering issue cannot leave the counters stale.
  [["metric-tracked", jobs.length], ["metric-applied", appliedCount], ["metric-responded", respondedCount], ["metric-interviews", interviewCount], ["metric-offers", offerCount], ["metric-hired", hiredCount]].forEach(([id, count]) => { const node = $(`#${id}`); if (node) node.textContent = count })
  const funnel = $("#funnel"); funnel.replaceChildren()
  [["Tracked", jobs.length, "blue"], ["Applied", appliedCount, "blue"], ["Responded", respondedCount, "violet"], ["Interview scheduled", interviewCount, "amber"], ["Offer", offerCount, "violet"], ["Hired", hiredCount, "green"]].forEach(([label, count, color]) => renderBar(funnel, label, count, jobs.length, color))
  $("#conversion").textContent = appliedCount ? `${Math.round(respondedCount / appliedCount * 100)}% response rate · ${Math.round(interviewCount / appliedCount * 100)}% reached interview stage` : "Mark jobs as applied to start measuring response and interview rates."
  const breakdown = $("#status-breakdown"); breakdown.replaceChildren()
  statusNames.forEach((status) => { const count = jobs.filter((job) => job.status === status).length; if (!count) return; const item = document.createElement("div"); item.className = "status-breakdown-row"; const badge = document.createElement("span"); badge.className = `status-badge status-${status.toLowerCase()}`; badge.textContent = status; const number = document.createElement("strong"); number.textContent = count; item.append(badge, number); breakdown.append(item) })
  if (!breakdown.children.length) breakdown.innerHTML = '<p class="empty-analytics">Your saved jobs and status updates will appear here.</p>'
  const events = jobs.flatMap((job) => (job.activity || []).map((event) => ({ ...event, title: job.title, company: job.company }))).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 10)
  const recent = $("#recent-activity"); recent.replaceChildren()
  if (!events.length) recent.innerHTML = '<p class="empty-analytics">No activity recorded yet. Prepare an application or update a job status to start your timeline.</p>'
  events.forEach((event) => { const row = document.createElement("div"); row.className = "recent-row"; row.innerHTML = `<span class="recent-dot"></span><div><strong>${esc(event.title)} · ${esc(event.company)}</strong><span>${esc(event.text)}</span></div><time>${new Date(event.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time>`; recent.append(row) })
}
function safeName(value) { return String(value || "job").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") }
function latexEscape(value) { const map = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "$": "\\$", "&": "\\&", "#": "\\#", "_": "\\_", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" }; return String(value).replace(/[\\{}%$&#_~^]/g, (char) => map[char]) }
function resumeInfo() {
  const lines = String(profile.resumeText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) throw new Error("Upload your resume in My Profile before preparing an application.")
  const rawName = lines.find((line) => !/@|https?:\/\/|\+?\d[\d ()-]{7,}/.test(line) && line.length < 90) || ""
  const name = rawName.replace(/\s*[—–-]\s*Resume\s*$/i, "").trim()
  const contact = lines.join(" ")
  const email = contact.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || ""
  const phone = contact.match(/\+?[\d][\d ()-]{7,}\d/)?.[0] || ""
  const headingRules = [
    ["Professional Summary", /^(professional summary|summary|profile|career profile|objective)$/i],
    ["Core Competencies", /^(core competencies|skills|technical skills|key skills|technologies|tools)$/i],
    ["Professional Experience", /^(professional experience|work experience|experience|employment history|career history)$/i],
    ["Projects", /^(projects|selected projects|key projects)$/i],
    ["Education", /^(education|academic background|qualifications)$/i],
    ["Certifications", /^(certifications|licenses|certificates)$/i],
    ["Achievements", /^(achievements|awards|honors|accomplishments)$/i],
    ["Publications", /^(publications|papers)$/i],
  ]
  const sections = new Map(), intro = []
  let current = ""
  for (const line of lines) {
    const match = headingRules.find(([, rule]) => rule.test(line.replace(/:$/, "")))
    if (match) { current = match[0]; if (!sections.has(current)) sections.set(current, []); continue }
    if (current) sections.get(current).push(line)
    else if (line !== rawName && line !== name && !line.includes(email) && !line.includes(phone)) intro.push(line)
  }
  return { lines, intro, sections, name, email, phone }
}
const skillTerms = ["OCI", "Oracle Cloud", "Fusion", "WebLogic", "Kubernetes", "K8s", "DevOps", "AIOps", "SRE", "Site Reliability", "AWS", "Azure", "GCP", "Terraform", "Ansible", "Jenkins", "Docker", "Linux", "Prometheus", "Grafana", "OpenShift", "Java", "Python", "CI/CD", "PostgreSQL", "MySQL", "Helm", "ArgoCD", "Puppet", "Chef", "Incident Management", "Observability"]
function relevantTerms(job, resume) {
  const jd = `${job.title || ""} ${job.description || ""}`.toLowerCase(), cv = resume.toLowerCase()
  return skillTerms.filter((term) => jd.includes(term.toLowerCase()) && cv.includes(term.toLowerCase()))
}
function buildResume(job) {
  const info = resumeInfo(), parts = info.name.split(/\s+/), first = parts.shift() || "Candidate", last = parts.join(" ")
  const contact = `${info.email ? `\\email{${latexEscape(info.email)}}\n` : ""}${info.phone ? `\\phone[mobile]{${latexEscape(info.phone)}}\n` : ""}`
  const terms = relevantTerms(job, profile.resumeText)
  const role = latexEscape(job.title || "Role")
  const order = ["Professional Summary", "Core Competencies", "Professional Experience", "Projects", "Education", "Certifications", "Achievements", "Publications"]
  const sectionNames = [...info.sections.keys()].sort((a, b) => { const ai = order.indexOf(a), bi = order.indexOf(b); return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) })
  const linesToItems = (items) => items.map((line) => `\\cvitem{}{${latexEscape(line)}}`).join("\n")
  const resumeSections = sectionNames.map((heading) => {
    let items = info.sections.get(heading)
    if (heading === "Core Competencies" && terms.length) items = [...items].sort((a, b) => terms.filter((term) => b.toLowerCase().includes(term.toLowerCase())).length - terms.filter((term) => a.toLowerCase().includes(term.toLowerCase())).length)
    return `\\section{${latexEscape(heading)}}\n${linesToItems(items)}`
  })
  if (info.intro.length) resumeSections.unshift(`\\section{Profile}\n${linesToItems(info.intro)}`)
  if (!resumeSections.length) resumeSections.push(`\\section{Resume}\n${linesToItems(info.lines.filter((line) => line !== info.name && line !== info.email && line !== info.phone))}`)
  return `\\documentclass[11pt,a4paper,sans]{moderncv}
\\moderncvstyle{banking}
\\moderncvcolor{blue}
\\renewcommand*{\\namefont}{\\fontsize{34}{36}\\bfseries\\upshape}
\\colorlet{firstnamecolor}{color1}\\colorlet{lastnamecolor}{color1}\\colorlet{namecolor}{color1}
\\renewcommand*{\\sectionstyle}[1]{{\\sectionfont\\color{color1}#1}}
\\usepackage[utf8]{inputenc}
\\ifpdftex\\usepackage[T1]{fontenc}\\fi
\\usepackage[scale=0.80]{geometry}
\\name{${latexEscape(first)}}{${latexEscape(last)}}
${contact}\\begin{document}
\\makecvtitle
\\section{Target Role}
\\cvitem{}{${role}}
${resumeSections.join("\n\n")}
\\end{document}`
}
function buildLetter(job) {
  const info = resumeInfo(), terms = relevantTerms(job, profile.resumeText)
  const contact = [info.email ? `\\href{mailto:${latexEscape(info.email)}}{${latexEscape(info.email)}}` : "", info.phone ? latexEscape(info.phone) : ""].filter(Boolean).join(" | ")
  const jdTerms = skillTerms.filter((term) => `${job.title || ""} ${job.description || ""}`.toLowerCase().includes(term.toLowerCase())).slice(0, 4)
  const evidence = terms.length ? `My resume documents experience with ${terms.slice(0, 5).join(", ")}, which aligns with several requirements in the posting.` : "I have reviewed the responsibilities in the posting and would welcome the opportunity to discuss how my documented background could support the team."
  const roleContext = jdTerms.length ? `The posting highlights ${jdTerms.join(", ")}.` : `The ${job.title || "role"} opportunity at ${job.company || "your organization"} interests me.`
  return `\\documentclass[]{cover}
\\usepackage{fancyhdr}
\\pagestyle{fancy}\\fancyhf{}\\rfoot{Page \\thepage \\hspace{0pt}}
\\thispagestyle{empty}\\renewcommand{\\headrulewidth}{0pt}
\\begin{document}
\\namesection{}{\\Huge{${latexEscape(info.name || "Candidate")}}}{${contact}}
\\currentdate{\\today}
\\lettercontent{Dear Hiring Team,}
\\lettercontent{I am applying for the ${latexEscape(job.title || "role")} position at ${latexEscape(job.company || "your organization")}${job.location ? ` in ${latexEscape(job.location)}` : ""}. ${latexEscape(roleContext)}}
\\lettercontent{${latexEscape(evidence)}}
\\lettercontent{My resume provides the details of my experience and accomplishments. I would be glad to discuss how they relate to the priorities of this role.}
\\lettercontent{Thank you for your consideration.}
\\begin{flushright}\\closing{Sincerely,}\\signature{${latexEscape(info.name || "Candidate")}}\\end{flushright}
\\end{document}`
}
async function saveDocs(job, card) {
  const resumeTex = $(".draft-resume", card).value, coverLetterTex = $(".draft-letter", card).value
  if (!resumeTex.trim() || !coverLetterTex.trim()) throw new Error("Generate both documents first.")
  await api(`/api/jobs/${encodeURIComponent(job.id)}/documents`, { method: "POST", body: JSON.stringify({ resumeTex, coverLetterTex }) })
}
function downloadText(filename, text) { if (!text.trim()) return; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], { type: "application/x-tex;charset=utf-8" })); link.download = filename; link.click(); URL.revokeObjectURL(link.href) }
async function prepareDocuments(job, card) {
  const documents = $(".documents-panel", card), message = $(".draft-message", card), button = $(".prepare-docs", card)
  button.disabled = true; button.textContent = "Generating and compiling…"; documents.classList.remove("hidden"); message.textContent = "Building the tailored LaTeX resume and cover letter…"
  try {
    $(".draft-resume", card).value = buildResume(job)
    $(".draft-letter", card).value = buildLetter(job)
    await saveDocs(job, card)
    message.textContent = "Drafts generated. Compiling PDFs with MiKTeX…"
    await api(`/api/jobs/${encodeURIComponent(job.id)}/documents/compile`, { method: "POST", body: "{}" })
    $(".resume-pdf", card).href = `/api/jobs/${encodeURIComponent(job.id)}/documents/resume.pdf?download=1`
    $(".letter-pdf", card).href = `/api/jobs/${encodeURIComponent(job.id)}/documents/cover-letter.pdf?download=1`
    $(".pdf-links", card).classList.remove("hidden")
    message.textContent = "Both PDFs are ready to download. Review the documents carefully before applying."
    jobs = await api("/api/jobs")
  } catch (error) {
    message.textContent = `${error.message} Your editable LaTeX source is available to download if generation completed.`
  } finally { button.disabled = false; button.textContent = "Generate documents again" }
}
function renderApplication(job) {
  const card = document.createElement("article"); card.className = "application-card"; card.dataset.id = job.id
  const isApplied = job.status === "Applied", hasApplied = progressedStatuses.includes(job.status)
  card.innerHTML = `<div class="application-card-head"><div><p class="eyebrow">${esc(job.company || "Company not listed")}</p><h3>${esc(job.title || "Untitled role")}</h3><p class="job-meta">${esc(job.location || "Location not listed")} · ${esc(job.date || "Date not listed")}</p></div><div class="application-pill-area"><span class="source-pill"></span><span class="applied-ribbon${isApplied ? "" : " hidden"}">✓ Applied</span></div></div><details class="description-details"><summary>View full job description</summary><div class="description-full">${esc(job.description || "Description not provided by the source.")}</div></details><div class="application-controls"><label class="status-control"><span>Status</span><select class="status-select">${statusNames.map((status) => `<option${status === job.status ? " selected" : ""}>${status}</option>`).join("")}</select></label><a class="button secondary employer-link${hasApplied ? " hidden" : ""}" target="_blank" rel="noopener noreferrer">Apply ↗</a><button class="button primary prepare-docs${hasApplied ? " hidden" : ""}" type="button">Prepare application ✦</button></div><textarea class="notes-input" placeholder="Notes: recruiter contact, next step, follow-up date…">${esc(job.notes || "")}</textarea><div class="application-controls"><button class="button tertiary save-job" type="button">Save status and notes</button><button class="button applied-action${hasApplied ? " hidden" : ""}" type="button">Mark as Applied ✓</button></div><section class="documents-panel hidden"><div class="documents-heading"><div><p class="eyebrow">TAILORED TO THIS LISTING</p><h4>Application documents</h4></div><p>Uses your uploaded resume and this job description. Review all claims before applying.</p></div><div class="draft-grid"><div class="draft-box"><div class="draft-title"><strong>Resume · PDF and LaTeX</strong><div><button class="button secondary download-resume" type="button">Download .tex</button></div></div><textarea class="draft-resume" rows="15" placeholder="Generated resume LaTeX source appears here."></textarea></div><div class="draft-box"><div class="draft-title"><strong>Cover letter · PDF and LaTeX</strong><div><button class="button secondary download-letter" type="button">Download .tex</button></div></div><textarea class="draft-letter" rows="15" placeholder="Generated cover letter LaTeX source appears here."></textarea></div></div><div class="latex-actions"><span class="draft-message" aria-live="polite"></span></div><div class="pdf-links hidden"><a class="button secondary resume-pdf">Download resume PDF</a><a class="button secondary letter-pdf">Download cover letter PDF</a></div></section>`
  const sourceBadge = $(".source-pill", card); sourceBadge.textContent = (job.sourcePortals || ["FreeHire"]).join(" · ")
  const link = $(".employer-link", card); if (/^https?:\/\//i.test(job.url || "")) link.href = job.url; else link.remove()
  $(".draft-resume", card).value = job.resumeDraft || ""; $(".draft-letter", card).value = job.coverLetterDraft || ""
  $(".save-job", card).addEventListener("click", async () => { try { await api(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", body: JSON.stringify({ status: $(".status-select", card).value, notes: $(".notes-input", card).value }) }); await reload() } catch (error) { alert(error.message) } })
  $(".applied-action", card).addEventListener("click", async () => { try { await api(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "PATCH", body: JSON.stringify({ status: "Applied", notes: $(".notes-input", card).value }) }); await reload() } catch (error) { alert(error.message) } })
  $(".status-select", card).addEventListener("change", (event) => {
    const selected = event.currentTarget.value
    $(".save-job", card).classList.toggle("hidden", selected === job.status && $(".notes-input", card).value === (job.notes || ""))
    $(".applied-action", card).classList.toggle("hidden", progressedStatuses.includes(selected))
    $(".employer-link", card).classList.toggle("hidden", progressedStatuses.includes(selected))
    $(".prepare-docs", card).classList.toggle("hidden", progressedStatuses.includes(selected))
  })
  $(".notes-input", card).addEventListener("input", () => {
    const unchanged = $(".status-select", card).value === job.status && $(".notes-input", card).value === (job.notes || "")
    $(".save-job", card).classList.toggle("hidden", unchanged)
  })
  $(".prepare-docs", card).addEventListener("click", () => prepareDocuments(job, card))
  $(".download-resume", card).addEventListener("click", () => downloadText(`${safeName(job.company)}-${safeName(job.title)}-resume.tex`, $(".draft-resume", card).value))
  $(".download-letter", card).addEventListener("click", () => downloadText(`${safeName(job.company)}-${safeName(job.title)}-cover-letter.tex`, $(".draft-letter", card).value))
  return card
}
function renderApplications() {
  const filter = $("#application-filter").value, list = $("#applications-list"); list.replaceChildren()
  const selected = jobs.filter((job) => filter === "All" || job.status === filter)
  if (!selected.length) { list.innerHTML = '<p class="empty-analytics">No applications in this status yet. Search jobs and choose Prepare application to add one.</p>'; return }
  selected.forEach((job) => list.append(renderApplication(job)))
  const id = new URLSearchParams(location.search).get("job")
  if (id && autoPreparedId !== id) { const card = [...list.children].find((item) => item.dataset.id === id); if (card) { autoPreparedId = id; card.scrollIntoView({ behavior: "smooth", block: "center" }); prepareDocuments(jobs.find((job) => job.id === id), card) } }
}
function render() {
  renderApplications()
}
async function reload() { jobs = await api("/api/jobs"); render() }
$("#application-filter").addEventListener("change", renderApplications)
Promise.all([api("/api/jobs"), api("/api/profile")]).then(([jobData, profileData]) => { jobs = jobData; profile = profileData; render() }).catch((error) => { $("#applications-list").textContent = error.message })
