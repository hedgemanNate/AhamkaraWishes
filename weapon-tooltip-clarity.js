/**
 * Handles Clarity tooltip logic: state, content generation, and positioning.
 * Separated from weapon-ui.js for cleaner architecture.
 */
window.weaponTooltipClarity = {
    tooltipEl: null,
    hoverTimer: null,
    hideTimer: null,
    currentPerkHash: null,

    /**
     * Initialize the tooltip DOM element.
     * Should be called during app startup.
     */
    init() {
        if (this.tooltipEl) return;

        this.tooltipEl = document.createElement('div');
        this.tooltipEl.id = 'clarity-tooltip';
        this.tooltipEl.style.display = 'none'; // Hidden by default
        document.body.appendChild(this.tooltipEl);
        
        console.log('[ClarityTooltip] Initialized');
    },

    /**
     * Handle mouse enter event on a perk/socket element.
     * @param {HTMLElement} targetEl - The element being hovered.
     * @param {number|string} perkHash - The hash of the perk to display.
     */
    handleHover(targetEl, perkHash) {
        if (!this.tooltipEl) {
            this.init();
        }
        if (!this.tooltipEl || !perkHash) {
            return;
        }
        // Clear any pending hide timer to prevent flickering if moving quickly between items
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }

        // If we're already showing this perk, just update position and return
        if (this.currentPerkHash === perkHash && this.tooltipEl.style.display !== 'none') {
             this.positionTooltip(targetEl);
             return;
        }

        // Clear existing hover timer to restart delay
        if (this.hoverTimer) clearTimeout(this.hoverTimer);

        this.currentPerkHash = perkHash;

        // Start delay before showing
        this.hoverTimer = setTimeout(async () => {
            await this.showTooltip(targetEl, perkHash);
        }, 100); // 100ms delay
    },

    /**
     * Handle mouse leave event.
     */
    handleLeave() {
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = null;
        }

        // Short grace period before hiding
        this.hideTimer = setTimeout(() => {
            if (this.tooltipEl) {
                this.tooltipEl.style.display = 'none';
                this.tooltipEl.classList.remove('visible');
                this.currentPerkHash = null;
            }
        }, 50);
    },

    /**
     * Fetch data, build content, and display the tooltip.
     */
    async showTooltip(targetEl, perkHash) {
        if (!this.tooltipEl) {
            this.init();
        }
        if (!this.tooltipEl || !perkHash || !window.weaponStatsService) return;

        const perkData = window.weaponStatsService.getPerkData(perkHash);
        
        // Build content
        this.tooltipEl.innerHTML = this.buildContent(perkData);
        
        // Position
        this.positionTooltip(targetEl);
        
        // Show
        this.tooltipEl.style.display = 'block';
        // Force reflow for transition
        void this.tooltipEl.offsetHeight;
        requestAnimationFrame(() => {
            this.tooltipEl.classList.add('visible');
        });
    },

    /**
     * Calculate and apply position.
     */
    positionTooltip(targetEl) {
        if (!this.tooltipEl || !targetEl) return;

        const rect = targetEl.getBoundingClientRect();
        const tooltipRect = this.tooltipEl.getBoundingClientRect();
        
        // Center horizontally above the target
        let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        let top = rect.top - tooltipRect.height - 8; // 8px gap

        // Viewport boundary checks
        const padding = 10;
        
        // Prevent going off left edge
        if (left < padding) left = padding;
        
        // Prevent going off right edge
        if (left + tooltipRect.width > window.innerWidth - padding) {
            left = window.innerWidth - tooltipRect.width - padding;
        }

        // Prevent going off top edge - flip to bottom if needed
        if (top < padding) {
            top = rect.bottom + 8;
        }

        this.tooltipEl.style.left = `${left}px`;
        this.tooltipEl.style.top = `${top}px`;
    },

    /**
     * Generate HTML content string.
     */
    buildContent(perkData) {
        if (!perkData) {
            return `
                <div class="clarity-content">
                    <div class="clarity-error">Perk data not found</div>
                </div>`;
        }
        
        // Extract Clarity specific data
        const clarity = perkData.clarity || {};
        const description = clarity.description || perkData.description || "No description available.";
        
        // Check if we have useful Clarity data or just reusing Bungie's
        const hasClarityData = !!clarity.description;

        let html = `<div class="clarity-content">`;
        
        // Title
        html += `<div class="clarity-title">${perkData.name}</div>`;
        
        // Description
        html += `<div class="clarity-desc">${description}</div>`;
        
        // Metadata (Notes, Source, Season) - Only if Clarity data exists
        if (hasClarityData) {
            const lines = [];
            if (clarity.notes) lines.push(`<span class="clarity-note">Note: ${clarity.notes}</span>`);
            if (clarity.source) lines.push(`<span class="clarity-source">Source: ${clarity.source}</span>`);
            if (clarity.season) lines.push(`<span class="clarity-season">Season: ${clarity.season}</span>`);
            
            if (lines.length > 0) {
                html += `<div class="clarity-meta">${lines.join('<br>')}</div>`;
            }
        } else if (!perkData.description) {
             html += `<div class="clarity-meta"><span class="clarity-warning">Clarity data unavailable</span></div>`;
        }

        // Stats
        const stats = [];
        
        const addStats = (obj, isConditional) => {
            if (!obj) return;
            for (const [key, value] of Object.entries(obj)) {
                if (value !== 0) {
                    stats.push({ key, value, isConditional });
                }
            }
        };

        if (perkData.static) addStats(perkData.static, false);
        if (perkData.conditional) addStats(perkData.conditional, true);

        if (stats.length > 0) {
            html += `<div class="clarity-stats-header">Stats</div><div class="clarity-stat-grid">`;
            stats.forEach(stat => {
                const sign = stat.value > 0 ? '+' : '';
                const colorClass = stat.value > 0 ? 'stat-pos' : 'stat-neg';
                const condClass = stat.isConditional ? 'stat-cond' : '';
                const condMarker = stat.isConditional ? '<span class="cond-marker">*</span>' : '';
                
                html += `
                    <div class="clarity-stat-row ${condClass}">
                        <span class="stat-name">${stat.key}${condMarker}</span>
                        <span class="stat-val ${colorClass}">${sign}${stat.value}</span>
                    </div>`;
            });
            html += `</div>`;
            if (stats.some(s => s.isConditional)) {
                html += `<div class="stat-cond-hint">* Conditional</div>`
            }
        }

        html += `</div>`;
        return html;
    }
};
