class VAOMApp {
    constructor() {
        this.orders = [];
        this.isRecording = false;
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.apiBaseUrl = 'http://localhost:3001/api';
        this.sessionId = 'user-' + Math.random().toString(36).substr(2, 9);
        this.lastOrderId = null;
        this.isWaitingForClarification = false;
        this.isWaitingForConfirmation = false;
        this.clarificationContext = null;
        this.pendingAction = null;
        this.environment = 'Quiet'; // Could be 'High Noise' for kiosk mode
        this.lastAction = '';
        this.totalTimeSaved = 0;
        
        this.initializeSpeechRecognition();
        this.bindEvents();
        this.loadOrders();
        this.loadSessionContext();
        this.initializeAnalytics();
    }

    initializeSpeechRecognition() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onstart = () => {
                this.isRecording = true;
                this.updateUI('recording');
            };

            this.recognition.onresult = (event) => {
                const transcript = Array.from(event.results)
                    .map(result => result[0].transcript)
                    .join('');
                
                this.showTranscript(transcript);
                
                if (event.results[0].isFinal) {
                    this.processVoiceCommand(transcript);
                }
            };

            this.recognition.onerror = (event) => {
                console.error('Speech recognition error:', event.error);
                this.updateUI('error');
                this.speak('Sorry, I didn\'t catch that. Please try again.');
            };

            this.recognition.onend = () => {
                this.isRecording = false;
                this.updateUI('idle');
            };
        } else {
            console.error('Speech recognition not supported');
            this.updateUI('not-supported');
        }
    }

    bindEvents() {
        const voiceButton = document.getElementById('voiceButton');
        const clearAllBtn = document.getElementById('clearAll');
        const kioskToggle = document.getElementById('kiosk-toggle');

        voiceButton.addEventListener('click', () => {
            if (this.isRecording) {
                this.stopRecording();
            } else {
                this.startRecording();
            }
        });

        clearAllBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all orders?')) {
                this.clearAllOrders();
            }
        });

        // Kiosk Mode Toggle
        if (kioskToggle) {
            kioskToggle.addEventListener('click', () => {
                this.toggleKioskMode();
            });
        }
    }

    toggleKioskMode() {
        const kioskToggle = document.getElementById('kiosk-toggle');
        const environmentElement = document.getElementById('environmentMode');
        
        if (this.environment === 'Quiet') {
            this.environment = 'High Noise';
            if (kioskToggle) kioskToggle.textContent = 'ON';
            if (kioskToggle) kioskToggle.classList.add('bg-yellow-500', 'text-black');
            if (environmentElement) environmentElement.textContent = 'High Noise';
            this.showToast('Kiosk Mode: High Noise - Short responses enabled');
        } else {
            this.environment = 'Quiet';
            if (kioskToggle) kioskToggle.textContent = 'OFF';
            if (kioskToggle) kioskToggle.classList.remove('bg-yellow-500', 'text-black');
            if (environmentElement) environmentElement.textContent = 'Quiet';
            this.showToast('Kiosk Mode: Quiet - Normal responses');
        }
    }

    startRecording() {
        if (this.recognition && !this.isRecording) {
            this.recognition.start();
        }
    }

    stopRecording() {
        if (this.recognition && this.isRecording) {
            this.recognition.stop();
        }
    }

    updateUI(state) {
        const voiceButton = document.getElementById('voiceButton');
        const statusText = document.getElementById('statusText');
        const transcript = document.getElementById('transcript');
        const processing = document.getElementById('processingIndicator');

        switch (state) {
            case 'recording':
                voiceButton.classList.add('recording');
                voiceButton.innerHTML = '<i class="fas fa-stop text-4xl"></i>';
                statusText.textContent = 'Listening... Speak now!';
                transcript.classList.add('hidden');
                processing.classList.add('hidden');
                break;
            case 'clarification':
                voiceButton.classList.add('recording', 'bg-orange-500');
                voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                statusText.textContent = 'Waiting for your response...';
                processing.classList.add('hidden');
                break;
            case 'processing':
                voiceButton.classList.remove('recording');
                voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                statusText.textContent = 'Processing your command...';
                processing.classList.remove('hidden');
                break;
            case 'idle':
                voiceButton.classList.remove('recording', 'bg-orange-500');
                voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                statusText.textContent = 'Click the microphone to start';
                processing.classList.add('hidden');
                break;
            case 'error':
                voiceButton.classList.remove('recording', 'bg-orange-500');
                voiceButton.innerHTML = '<i class="fas fa-microphone text-4xl"></i>';
                statusText.textContent = 'Error occurred. Try again.';
                processing.classList.add('hidden');
                break;
            case 'not-supported':
                voiceButton.disabled = true;
                voiceButton.classList.add('opacity-50', 'cursor-not-allowed');
                statusText.textContent = 'Speech recognition not supported in your browser';
                break;
        }
    }

    showTranscript(text) {
        const transcript = document.getElementById('transcript');
        const transcriptText = document.getElementById('transcriptText');
        
        transcript.classList.remove('hidden');
        transcriptText.textContent = text;
    }

    async processVoiceCommand(transcript) {
        this.updateUI('processing');
        
        try {
            // Check for context reset phrases
            const contextResetPhrases = ['no', 'wait', 'actually', 'scratch that', 'never mind', 'cancel', 'changed my mind'];
            const hasContextReset = contextResetPhrases.some(phrase => 
                transcript.toLowerCase().includes(phrase)
            );
            
            if (hasContextReset && this.lastOrderId) {
                this.showToast('🔄 Correction detected - clearing pending order visual', 'warning');
                // Clear any optimistic UI for the last order
                const lastOrderRow = document.getElementById(`order-${this.lastOrderId}`);
                if (lastOrderRow) {
                    lastOrderRow.classList.remove('optimistic-adding', 'glow-green');
                    lastOrderRow.classList.add('optimistic-updating');
                }
            }
            
            // Send to local AI endpoint
            const response = await fetch(`${this.apiBaseUrl}/voice-process`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    command: transcript,
                    sessionId: this.sessionId,
                    environment: this.environment,
                    lastOrderId: this.lastOrderId
                })
            });

            const aiResponse = await response.json();
            console.log('AI Response:', aiResponse);
            
            // Apply optimistic UI immediately (before database confirms)
            if (aiResponse.optimistic_ui) {
                this.applyOptimisticUI(aiResponse.optimistic_ui);
            }
            
            // Handle context reset
            if (aiResponse.context_reset) {
                this.showToast('✏️ Correction processed: ' + aiResponse.voice_response, 'info');
            }
            
            // Update analytics display
            if (aiResponse.analytics) {
                this.updateAnalyticsDisplay(aiResponse.analytics);
            }
            
            // Update last order ID from response
            if (aiResponse.data?.order_id) {
                this.lastOrderId = aiResponse.data.order_id;
            }
            
            // Update total time saved
            if (aiResponse.analytics?.time_saved) {
                this.totalTimeSaved += aiResponse.analytics.time_saved;
                this.updateTimeSavedCounter();
            }
            
            // Show dashboard hint
            if (aiResponse.dashboard_hint) {
                this.showToast(aiResponse.dashboard_hint);
            }
            
            // Execute the action
            await this.executeAIAction(aiResponse);
            
        } catch (error) {
            console.error('Error processing voice command:', error);
            this.speak('Sorry, there was an error processing your request.');
        } finally {
            this.updateUI('idle');
        }
    }

    async handleCreateCommand(transcript) {
        // Simple parsing for demo purposes
        const quantityMatch = transcript.match(/(\d+)/);
        const quantity = quantityMatch ? parseInt(quantityMatch[1]) : 1;
        
        // Extract item name (basic implementation)
        const items = ['pizza', 'burger', 'coffee', 'sandwich', 'salad', 'pasta'];
        const item = items.find(i => transcript.toLowerCase().includes(i)) || 'item';
        
        return {
            action: 'CREATE',
            data: { item, quantity },
            voice_response: `Placing an order for ${quantity} ${item}${quantity > 1 ? 's' : ''}.`
        };
    }

    async handleTrackCommand(transcript) {
        const orderMatch = transcript.match(/(\d+)/);
        if (orderMatch) {
            return {
                action: 'TRACK',
                data: { order_id: parseInt(orderMatch[1]) },
                voice_response: `Checking the status of order ${orderMatch[1]}.`
            };
        } else {
            const items = ['pizza', 'burger', 'coffee', 'sandwich', 'salad', 'pasta'];
            const item = items.find(i => transcript.toLowerCase().includes(i));
            return {
                action: 'TRACK',
                data: { item },
                voice_response: `Checking the status of your ${item} order.`
            };
        }
    }

    async handleUpdateCommand(transcript) {
        const orderMatch = transcript.match(/(\d+)/);
        const quantityMatch = transcript.match(/(\d+)/);
        
        if (orderMatch) {
            return {
                action: 'UPDATE',
                data: { 
                    order_id: parseInt(orderMatch[1]),
                    quantity: quantityMatch ? parseInt(quantityMatch[1]) : null
                },
                voice_response: `Updating order ${orderMatch[1]}.`
            };
        }
        
        return {
            action: 'CLARIFY',
            data: null,
            voice_response: 'Please specify which order you want to update.'
        };
    }

    async handleDeleteCommand(transcript) {
        const orderMatch = transcript.match(/(\d+)/);
        if (orderMatch) {
            return {
                action: 'DELETE',
                data: { order_id: parseInt(orderMatch[1]) },
                voice_response: `Cancelling order ${orderMatch[1]}.`
            };
        }
        
        return {
            action: 'CLARIFY',
            data: null,
            voice_response: 'Please specify which order you want to cancel.'
        };
    }

    async executeExecutiveAction(executiveResponse) {
        const { action, data, voice_response } = executiveResponse;
        
        // Always speak the response (except for IGNORE)
        if (action !== 'IGNORE') {
            this.speak(voice_response);
        }
        
        // Update last action for context
        this.lastAction = action;
        
        try {
            switch (action) {
                case 'CREATE':
                    await this.createMultipleOrders(data);
                    break;
                case 'TRACK':
                    await this.trackOrder(data);
                    break;
                case 'UPDATE':
                    await this.updateOrder(data);
                    break;
                case 'DELETE':
                    await this.deleteOrder(data);
                    break;
                case 'CLARIFY':
                    this.handleClarification(executiveResponse);
                    break;
                case 'CONFIRM_EXECUTE':
                    await this.executeConfirmedAction(data);
                    break;
                case 'IGNORE':
                    // Silent ignore for background noise
                    break;
            }
        } catch (error) {
            console.error('Error executing action:', error);
            this.speak('Sorry, there was an error executing your request.');
        }
    }

    handleClarification(masterResponse) {
        if (masterResponse.data.require_confirmation) {
            this.isWaitingForConfirmation = true;
            this.pendingAction = masterResponse.data;
        } else {
            this.isWaitingForClarification = true;
            this.clarificationContext = masterResponse.data;
        }
        
        // Keep microphone hot for clarification response
        setTimeout(() => {
            if (this.isWaitingForClarification || this.isWaitingForConfirmation) {
                this.startRecording();
                this.updateUI('clarification');
            }
        }, 1500); // Wait for TTS to finish
    }

    async executeConfirmedAction(data) {
        // Execute the confirmed action based on the pending data
        if (data.order_id) {
            // This is likely a delete operation
            await this.deleteOrder({ order_id: data.order_id });
        } else if (data.items_list) {
            // This is likely a create operation
            await this.createMultipleOrders(data);
        }
        
        // Clear confirmation state
        this.isWaitingForConfirmation = false;
        this.pendingAction = null;
        
        // Trigger confetti for successful execution
        this.triggerConfetti();
    }

    applyOptimisticUI(optimisticUI) {
        const { action_preview, target_id, highlight_color } = optimisticUI;
        
        // Apply optimistic UI effects immediately
        if (action_preview) {
            switch (action_preview) {
                case 'ADDING_ITEMS':
                    // Show optimistic addition effect
                    this.showOptimisticEffect('adding');
                    break;
                case 'HIDING_ROW':
                    if (target_id) {
                        const targetRow = document.getElementById(`order-${target_id}`);
                        if (targetRow) {
                            targetRow.classList.add('optimistic-hiding');
                        }
                    }
                    break;
                case 'UPDATING_ITEM':
                case 'REPLACING_ITEM':
                    if (target_id) {
                        const targetRow = document.getElementById(`order-${target_id}`);
                        if (targetRow) {
                            targetRow.classList.add('optimistic-updating');
                        }
                    }
                    break;
                case 'HIGHLIGHTING_ROW':
                case 'HIGHLIGHTING_ROWS':
                    if (target_id) {
                        const targetRow = document.getElementById(`order-${target_id}`);
                        if (targetRow) {
                            targetRow.style.backgroundColor = highlight_color || '#3b82f6';
                            setTimeout(() => {
                                targetRow.style.backgroundColor = '';
                            }, 2000);
                        }
                    }
                    break;
            }
        }
    }
    
    showOptimisticEffect(type) {
        // Show a temporary optimistic UI indicator
        const indicator = document.createElement('div');
        indicator.className = `fixed top-20 right-4 px-4 py-2 rounded-lg shadow-lg z-50 optimistic-${type}`;
        indicator.innerHTML = `<i class="fas fa-plus mr-2"></i>Adding item...`;
        document.body.appendChild(indicator);
        
        setTimeout(() => {
            document.body.removeChild(indicator);
        }, 1000);
    }
    
    updateAnalyticsDisplay(analytics) {
        // Update intent confidence bar
        if (analytics.intent_confidence !== undefined) {
            const confidenceBar = document.getElementById('confidence-bar');
            const confidencePercent = Math.round(analytics.intent_confidence * 100);
            if (confidenceBar) {
                confidenceBar.style.width = `${confidencePercent}%`;
            }
        }
    }
    
    updateTimeSavedCounter() {
        const counter = document.getElementById('time-saved-counter');
        if (counter) {
            const minutes = Math.floor(this.totalTimeSaved / 60);
            const seconds = this.totalTimeSaved % 60;
            
            if (minutes > 0) {
                counter.textContent = `${minutes}m ${seconds}s`;
            } else {
                counter.textContent = `${seconds}s`;
            }
            
            // Flash animation
            counter.classList.add('animate-pulse', 'text-green-300');
            setTimeout(() => {
                counter.classList.remove('animate-pulse', 'text-green-300');
            }, 1000);
        }
    }
    
    async executeAIAction(aiResponse) {
        const { action, data, voice_response, context_reset } = aiResponse;
        
        // Always speak the response
        if (voice_response) {
            this.speak(voice_response);
        }
        
        try {
            switch (action) {
                case 'CREATE':
                    if (data.saved_order) {
                        // Order was already saved by backend
                        this.orders.push(data.saved_order);
                        this.lastOrderId = data.saved_order.id;
                        this.renderOrders();
                        
                        // Add glow effect to new row
                        setTimeout(() => {
                            const newRow = document.getElementById(`order-${data.saved_order.id}`);
                            if (newRow) {
                                newRow.classList.add('glow-green');
                                setTimeout(() => newRow.classList.remove('glow-green'), 2000);
                            }
                        }, 100);
                    }
                    break;
                    
                case 'UPDATE':
                    if (context_reset && data.saved_order) {
                        // Handle correction - update the last order
                        await this.loadOrders();
                        this.showToast(`✅ Corrected to ${data.item} x${data.quantity}`);
                    }
                    break;
                    
                case 'DELETE':
                    if (data.require_confirmation) {
                        // Show confirmation dialog
                        this.isWaitingForConfirmation = true;
                        this.pendingAction = data;
                        
                        // Pulse red the target row
                        if (data.order_id) {
                            const targetRow = document.getElementById(`order-${data.order_id}`);
                            if (targetRow) {
                                targetRow.classList.add('pulse-red');
                            }
                        }
                        
                        // Keep mic hot for response
                        setTimeout(() => {
                            if (this.isWaitingForConfirmation) {
                                this.startRecording();
                                this.updateUI('confirmation');
                            }
                        }, 2000);
                    }
                    break;
                    
                case 'CONFIRM_EXECUTE':
                    // Execute the pending delete
                    if (this.pendingAction?.order_id) {
                        await this.deleteOrder({ order_id: this.pendingAction.order_id });
                        this.triggerConfetti();
                    }
                    this.isWaitingForConfirmation = false;
                    this.pendingAction = null;
                    break;
            }
        } catch (error) {
            console.error('Error executing AI action:', error);
        }
    }
    
    initializeAnalytics() {
        // Load initial analytics from backend
        this.loadAnalytics();
        
        // Update environment mode display
        const environmentElement = document.getElementById('environmentMode');
        if (environmentElement) {
            environmentElement.textContent = this.environment;
        }
    }
    
    async loadAnalytics() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/analytics/${this.sessionId}`);
            if (response.ok) {
                const analytics = await response.json();
                this.totalTimeSaved = analytics.total_time_saved || 0;
                this.updateTimeSavedDisplay();
            }
        } catch (error) {
            console.error('Error loading analytics:', error);
        }
    }

    async handleClarificationResponse(transcript) {
        // Handle confirmation responses first
        if (this.isWaitingForConfirmation) {
            const confirmWords = ['yes', 'yeah', 'yep', 'sure', 'do it', 'confirm', 'execute', 'proceed'];
            const cancelWords = ['no', 'cancel', 'stop', 'never mind', 'abort'];
            
            if (confirmWords.some(word => transcript.toLowerCase().includes(word))) {
                await this.executeConfirmedAction(this.pendingAction);
            } else if (cancelWords.some(word => transcript.toLowerCase().includes(word))) {
                this.speak('Action cancelled.');
                this.showToast('Action cancelled');
            } else {
                this.speak('Please say yes or no.');
                return; // Keep microphone active
            }
            
            this.isWaitingForConfirmation = false;
            this.pendingAction = null;
            return;
        }
        
        // Handle regular clarification responses
        this.isWaitingForClarification = false;
        const context = this.clarificationContext;
        this.clarificationContext = null;
        
        // Build a complete command with the clarification context
        let fullCommand = transcript;
        
        if (context && context.items_list && context.items_list.length > 0) {
            // If we were asking for quantity, prepend the item
            const item = context.items_list[0].item;
            fullCommand = `${item} ${transcript}`;
        }
        
        // Process the complete command
        const response = await fetch(`${this.apiBaseUrl}/voice-intent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                command: fullCommand,
                sessionId: this.sessionId,
                environment: this.environment,
                lastAction: this.lastAction,
                currentOrderState: this.orders
            })
        });
        
        const executiveResponse = await response.json();
        
        // Apply optimistic UI
        if (executiveResponse.optimistic_ui) {
            this.applyOptimisticUI(executiveResponse.optimistic_ui);
        }
        
        // Update analytics
        if (executiveResponse.analytics) {
            this.updateAnalytics(executiveResponse.analytics);
        }
        
        // Execute the action
        await this.executeExecutiveAction(executiveResponse);
    }

    handleReject(aiResponse) {
        // Show error toast and reset
        this.showToast(aiResponse.dashboard_hint || 'Command not recognized', 'error');
        this.updateUI('idle');
    }

    async createMultipleOrders(data) {
        if (!data.items_list || data.items_list.length === 0) {
            return;
        }
        
        // Create orders for each item in the list
        for (const itemData of data.items_list) {
            const response = await fetch(`${this.apiBaseUrl}/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    item: itemData.item,
                    quantity: itemData.qty || 1
                })
            });
            
            if (response.ok) {
                const newOrder = await response.json();
                this.orders.push(newOrder);
                this.lastOrderId = newOrder.id; // Update context with last order
            }
        }
        
        this.renderOrders();
    }

    async trackOrder(data) {
        let order;
        if (data.order_id) {
            const response = await fetch(`${this.apiBaseUrl}/orders/${data.order_id}`);
            if (response.ok) {
                order = await response.json();
            }
        } else if (data.item) {
            // Find first order with matching item
            order = this.orders.find(o => o.item.toLowerCase().includes(data.item.toLowerCase()));
        }
        
        if (order) {
            this.speak(`Your ${order.item} order is ${order.status}.`);
            this.highlightOrder(order.id);
        } else {
            this.speak('Order not found.');
        }
    }

    async updateOrder(data) {
        const response = await fetch(`${this.apiBaseUrl}/orders/${data.order_id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 'updated' })
        });
        
        if (response.ok) {
            await this.loadOrders();
            this.speak(`Order ${data.order_id} has been updated.`);
        }
    }

    async deleteOrder(data) {
        const response = await fetch(`${this.apiBaseUrl}/orders/${data.order_id}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            this.animateOrderDeletion(data.order_id);
            await this.loadOrders();
        }
    }

    async loadOrders() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/orders`);
            if (response.ok) {
                this.orders = await response.json();
                this.renderOrders();
            }
        } catch (error) {
            console.error('Error loading orders:', error);
            // Fallback to local storage for demo
            this.orders = JSON.parse(localStorage.getItem('orders') || '[]');
            this.renderOrders();
        }
    }

    renderOrders() {
        const tbody = document.getElementById('ordersTableBody');
        const orderCount = document.getElementById('orderCount');
        
        orderCount.textContent = this.orders.length;
        
        if (this.orders.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-8 text-gray-500">
                        No orders yet. Start by using voice commands!
                    </td>
                </tr>
            `;
            return;
        }
        
        tbody.innerHTML = this.orders.map(order => `
            <tr id="order-${order.id}" class="border-b hover:bg-gray-50 transition-colors">
                <td class="py-3 px-4 font-medium">#${order.id}</td>
                <td class="py-3 px-4">${order.item}</td>
                <td class="py-3 px-4">${order.quantity}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 text-xs rounded-full ${this.getStatusClass(order.status)}">
                        ${order.status}
                    </span>
                </td>
                <td class="py-3 px-4">
                    <button onclick="app.deleteOrderById(${order.id})" class="text-red-500 hover:text-red-700 transition-colors">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    getStatusClass(status) {
        const classes = {
            'pending': 'bg-yellow-100 text-yellow-800',
            'preparing': 'bg-blue-100 text-blue-800',
            'completed': 'bg-green-100 text-green-800',
            'cancelled': 'bg-red-100 text-red-800'
        };
        return classes[status] || 'bg-gray-100 text-gray-800';
    }

    async deleteOrderById(orderId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/orders/${orderId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.animateOrderDeletion(orderId);
                await this.loadOrders();
            }
        } catch (error) {
            console.error('Error deleting order:', error);
        }
    }

    async clearAllOrders() {
        try {
            // Delete all orders
            for (const order of this.orders) {
                await fetch(`${this.apiBaseUrl}/orders/${order.id}`, {
                    method: 'DELETE'
                });
            }
            await this.loadOrders();
        } catch (error) {
            console.error('Error clearing orders:', error);
        }
    }

    speak(text) {
        if (this.synthesis.speaking) {
            this.synthesis.cancel();
        }
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        this.synthesis.speak(utterance);
    }

    showToast(message, type = 'success') {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 transform transition-all duration-300 translate-x-full`;
        
        // Style based on type
        if (type === 'error') {
            toast.classList.add('bg-red-500', 'text-white');
        } else {
            toast.classList.add('bg-green-500', 'text-white');
        }
        
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Animate in
        setTimeout(() => {
            toast.classList.remove('translate-x-full');
            toast.classList.add('translate-x-0');
        }, 100);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }

    async loadSessionContext() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/session/${this.sessionId}/context`);
            if (response.ok) {
                const context = await response.json();
                this.lastOrderId = context.lastOrderId;
            }
        } catch (error) {
            console.error('Error loading session context:', error);
        }
    }

    triggerConfetti() {
        const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
        
        for (let i = 0; i < 50; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = Math.random() * 100 + '%';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
                document.body.appendChild(confetti);
                
                setTimeout(() => confetti.remove(), 3000);
            }, i * 30);
        }
    }

    highlightOrder(orderId) {
        const orderRow = document.getElementById(`order-${orderId}`);
        if (orderRow) {
            orderRow.classList.add('bg-blue-100', 'border-blue-300');
            setTimeout(() => {
                orderRow.classList.remove('bg-blue-100', 'border-blue-300');
            }, 2000);
        }
    }

    animateOrderDeletion(orderId) {
        const orderRow = document.getElementById(`order-${orderId}`);
        if (orderRow) {
            orderRow.classList.add('fade-out');
            setTimeout(() => {
                orderRow.remove();
            }, 500);
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VAOMApp();
});
