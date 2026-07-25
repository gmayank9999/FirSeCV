const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Compile a LaTeX string to PDF.
 * Uses tectonic if available, falls back to pdflatex.
 * Returns the PDF as a Buffer.
 *
 * @param {string} latexSource - Full .tex content as a string
 * @returns {Promise<Buffer>} PDF file contents
 */
async function compileLaTeX(latexSource) {
  // Work in a temp directory so compilation artifacts don't pollute the project
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'firsecv-'));
  const texFile = path.join(tmpDir, 'resume.tex');
  const pdfFile = path.join(tmpDir, 'resume.pdf');

  try {
    fs.writeFileSync(texFile, latexSource, 'utf8');

    // Try tectonic first (faster, auto-downloads packages)
    const hasTectonic = await commandExists('tectonic');
    const hasPdflatex = await commandExists('pdflatex');

    if (!hasTectonic && !hasPdflatex) {
      throw new Error(
        'No LaTeX compiler found. Please install tectonic (recommended: brew install tectonic) or TeX Live (brew install --cask mactex-no-gui).'
      );
    }

    let cmd;
    if (hasTectonic) {
      // tectonic outputs the PDF next to the .tex file
      cmd = `tectonic "${texFile}"`;
    } else {
      // pdflatex needs -interaction=nonstopmode to not hang on errors
      // Run twice for proper cross-references
      cmd = `pdflatex -interaction=nonstopmode -output-directory="${tmpDir}" "${texFile}" && pdflatex -interaction=nonstopmode -output-directory="${tmpDir}" "${texFile}"`;
    }

    const { stdout, stderr } = await execAsync(cmd, { timeout: 60000 });

    if (process.env.NODE_ENV !== 'production') {
      if (stdout) console.log('[LaTeX stdout]', stdout.slice(-500));
      if (stderr) console.warn('[LaTeX stderr]', stderr.slice(-500));
    }

    if (!fs.existsSync(pdfFile)) {
      throw new Error(`PDF not generated. Check LaTeX source for syntax errors.\nstderr: ${stderr}`);
    }

    const pdfBuffer = fs.readFileSync(pdfFile);
    return pdfBuffer;

  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Check if a CLI command exists on the system PATH.
 */
async function commandExists(cmd) {
  try {
    const checkCmd = process.platform === 'win32'
      ? `where ${cmd}`
      : `which ${cmd}`;
    await execAsync(checkCmd);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { compileLaTeX };
