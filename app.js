import { convert } from './lib.js'

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#form')
  const alert = document.querySelector('#alert')

  const showAlert = (message, type = 'error') => {
    const p = document.createElement('p')
    p.classList.add('alert', type)
    p.innerText = message

    alert.innerHTML = ''
    alert.appendChild(p)
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()

    const fileInput = document.querySelector('#file')
    const caloriesInput = document.querySelector('#calories')

    if (!fileInput.files || fileInput.files.length === 0) {
      showAlert('Please select a FIT file to convert.', 'error')
      return
    }

    const calories = parseInt(caloriesInput.value, 10)
    if (Number.isNaN(calories) || calories < 0) {
      showAlert('Please enter a valid positive number for calories.', 'error')
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
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showAlert('File converted successfully!', 'success')
    } catch (error) {
      console.error('Conversion error:', error)
      showAlert(`Error converting file: ${error.message}`, 'error')
    }
  })
})
