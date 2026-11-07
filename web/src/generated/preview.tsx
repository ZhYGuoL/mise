/** Lane B bench entry: http://localhost:<WEB_PORT>/src/generated/preview.html */
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { Bench } from './Bench'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Bench />
    </MotionConfig>
  </StrictMode>,
)
