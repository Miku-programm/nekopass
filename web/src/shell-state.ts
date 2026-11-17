import { ref } from 'vue'

// Shared with the persistent sidebar, which outlives individual page components.
export const pendingTickets = ref(0)
