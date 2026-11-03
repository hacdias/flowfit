import { convert } from './lib.js'

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#form')
  const alert = document.querySelector('#alert')
  const alertDetails = document.querySelector('#alert-details')
  const report = document.querySelector('#report')
  const dropzone = document.querySelector('#dropzone')
  const fileInput = document.querySelector('#file')
  const fileEmpty = document.querySelector('#file-empty')
  const fileSelected = document.querySelector('#file-selected')
  const fileName = document.querySelector('#file-name')
  const fileSize = document.querySelector('#file-size')
  const caloriesInput = document.querySelector('#calories')
  const submit = document.querySelector('#submit')
  const success = document.querySelector('#success')
  const outputName = document.querySelector('#output-name')
  const submitLabel = submit.textContent

  // Link to the converted file, kept until reset so it can be downloaded again.
  let link = null

  const showAlert = (message) => {
    alertDetails.textContent = message
    alert.hidden = false
    report.hidden = false
    submit.textContent = 'Try again'
  }

  const hideAlert = () => {
    alert.hidden = true
    report.hidden = true
    submit.textContent = submitLabel
  }

  // Toggles the error state of the input's parent and #<id>-error.
  const setInvalid = (input, invalid) => {
    const message = document.querySelector(`#${input.id}-error`)
    input.parentElement.classList.toggle('invalid', invalid)
    message.hidden = !invalid
    input.setAttribute('aria-invalid', invalid)
    if (invalid) {
      input.setAttribute('aria-describedby', message.id)
    } else {
      input.removeAttribute('aria-describedby')
    }
  }

  const showFile = () => {
    const file = fileInput.files[0]
    const valid = !!file && file.name.toLowerCase().endsWith('.fit')

    hideAlert()
    dropzone.dataset.state = file ? 'selected' : 'empty'
    fileEmpty.hidden = !!file
    fileSelected.hidden = !file
    fileInput.setAttribute(
      'aria-label',
      file ? `Change file, ${file.name}` : 'Choose a .fit file'
    )
    submit.disabled = !valid
    setInvalid(fileInput, !!file && !valid)

    if (file) {
      fileName.textContent = file.name
      fileName.title = file.name
      fileSize.textContent = `${Math.ceil(file.size / 1024)} KB`
    }
  }

  const save = (a) => {
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  fileInput.addEventListener('change', showFile)

  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault()
    dropzone.classList.add('over')
  })

  dropzone.addEventListener('dragleave', (event) => {
    // The selected block has children, and moving between them isn't leaving.
    if (!dropzone.contains(event.relatedTarget)) {
      dropzone.classList.remove('over')
    }
  })

  dropzone.addEventListener('drop', (event) => {
    event.preventDefault()
    dropzone.classList.remove('over')
    // Dropping something that isn't a file, e.g. text, must keep the current one.
    if (event.dataTransfer.files.length > 0) {
      fileInput.files = event.dataTransfer.files
      showFile()
    }
  })

  document.querySelector('#remove').addEventListener('click', () => {
    fileInput.value = ''
    showFile()
    fileInput.focus()
  })

  caloriesInput.addEventListener('input', () =>
    setInvalid(caloriesInput, false)
  )

  form.addEventListener('submit', async (event) => {
    event.preventDefault()

    const calories = parseInt(caloriesInput.value, 10)
    if (Number.isNaN(calories) || calories < 0) {
      setInvalid(caloriesInput, true)
      caloriesInput.focus()
      return
    }

    try {
      const file = fileInput.files[0]
      const arrayBuffer = await file.arrayBuffer()
      const inputBytes = new Uint8Array(arrayBuffer)

      const convertedData = convert(inputBytes, {
        calories,
      })

      // Create a download link for the converted file
      const blob = new Blob([convertedData], {
        type: 'application/octet-stream',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `converted-${file.name}`
      save(a)

      link = a
      outputName.textContent = a.download
      outputName.title = a.download
      form.hidden = true
      success.hidden = false
      document.querySelector('#success-title').focus()
    } catch (error) {
      console.error('Conversion error:', error)
      showAlert(error.message)
    }
  })

  document.querySelector('#redownload').addEventListener('click', () => {
    save(link)
  })

  document.querySelector('#again').addEventListener('click', () => {
    URL.revokeObjectURL(link.href)
    link = null
    form.reset()
    showFile()
    success.hidden = true
    form.hidden = false
    fileInput.focus()
  })

  // Sync with state the browser restored, e.g. Firefox keeps `disabled`.
  showFile()
})
