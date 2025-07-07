const BACKEND_URL_FINAL = "http://127.0.0.1:8000/ask";
const QUIZ_URL_FINAL = "http://127.0.0.1:8000/quiz";
const QUIZ_EVAL_URL_FINAL = "http://127.0.0.1:8000/quiz/evaluate";
const SUGGEST_URL_FINAL = "http://127.0.0.1:8000/suggest";

// Global AbortController for managing quiz fetch requests
let quizFetchController = null;

document.addEventListener('DOMContentLoaded', () => {
  const chatWindow = document.getElementById('chat-window');
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const micBtn = document.getElementById('mic-btn');
  const avatars = { user: '👩', bot: '🤖' };

  // --- Restore Default Session Structure if Missing ---
  let groupedSessions = JSON.parse(localStorage.getItem('kkh-grouped-sessions')) || [
    {
      category: "General",
      expanded: true,
      chats: [{ id: "general-welcome", name: "Chat 1" }]
    },
    {
      category: "Quiz",
      expanded: true,
      chats: []
    }
  ];
  localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));

  // Load sessions or fallback
  let activeSessionId = localStorage.getItem('kkh-active-session') || 'general-welcome';
  
  // Check if the active session still exists in grouped sessions
  const sessionExists = groupedSessions.some(group => 
    group.chats.some(chat => chat.id === activeSessionId)
  );
  
  // If the active session doesn't exist, fallback to general-welcome
  if (!sessionExists) {
    activeSessionId = 'general-welcome';
    localStorage.setItem('kkh-active-session', activeSessionId);
  }
  
  let currentQuiz = [];
  let quizAnswers = {};
  let currentQuizSessionId = null;

  function renderSessions() {
  const generalList = document.getElementById('general-sessions');
  const quizList = document.getElementById('quiz-sessions');
  if (!generalList || !quizList) return;

  generalList.innerHTML = '';
  quizList.innerHTML = '';

  groupedSessions.forEach(group => {
    const target = group.category === 'General' ? generalList : quizList;

    group.chats.forEach((chat, index) => {
      const chatDiv = document.createElement('div');
      chatDiv.className = 'chat-session';
      chatDiv.id = chat.id;

      // ✅ Proper switchSession call on click
      chatDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      switchSession(group, chat, index);
      });

      // Display chat name
      const nameSpan = document.createElement('span');
      nameSpan.textContent = chat.name;
      nameSpan.style.flex = '1';
      chatDiv.appendChild(nameSpan);

      // Menu for rename / delete
      const menu = document.createElement('div');
      menu.className = 'chat-menu';
      menu.textContent = '⋮';

      const dropdown = document.createElement('div');
      dropdown.className = 'chat-dropdown';

      const renameOption = document.createElement('div');
      renameOption.className = 'rename-option';
      renameOption.textContent = 'Rename';
      renameOption.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering session switch
        const newName = prompt('Enter new session name:');
        if (newName) {
          chat.name = newName;
          localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));
          renderSessions();
          attachSessionListeners();
        }
      });

      const deleteOption = document.createElement('div');
      deleteOption.className = 'delete-option';
      deleteOption.textContent = 'Delete';
      deleteOption.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering session switch
        if (confirm('Delete this session?')) {
          group.chats.splice(index, 1);
          localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));
          renderSessions();
          attachSessionListeners();
        }
      });

      dropdown.appendChild(renameOption);
      dropdown.appendChild(deleteOption);
      menu.appendChild(dropdown);
      chatDiv.appendChild(menu);
      target.appendChild(chatDiv);
    });
  });
  
  // Update active session highlighting after rendering
  updateActiveSessionHighlight();
}

function attachSessionListeners() {
  document.querySelectorAll('.chat-session').forEach(item => {
    item.addEventListener('click', () => {
      const sessionId = item.id;
      const group = groupedSessions.find(g => g.chats.some(c => c.id === sessionId));
      const chat = group?.chats.find(c => c.id === sessionId);
      if (group && chat) switchSession(group, chat, group.chats.indexOf(chat));
    });
  });
}
  renderSessions();
  attachSessionListeners();

  // New session buttons
  document.querySelectorAll('.new-session-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const category = btn.getAttribute('data-category');
    const group = groupedSessions.find(g => g.category === category);
    if (!group) return;

    if (category === 'Quiz') {
      // For quiz sessions, show topic selection first
      showTopicSelectionForNewSession(group);
    } else {
      // For general sessions, create immediately
      const newChat = {
        id: `${category.toLowerCase()}-${Date.now()}`,
        name: `Chat ${group.chats.length + 1}`
      };

      group.chats.push(newChat);
      localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));
      renderSessions();
      attachSessionListeners();
    }
  });
});

  // --- Rename / Delete ---
  function attachMenuHandlers() {
    document.querySelectorAll('.rename-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const groupName = btn.getAttribute('data-group');
        const index = btn.getAttribute('data-index');
        const newName = prompt('Enter new session name:');
        if (newName) {
          const group = groupedSessions.find(g => g.category === groupName);
          group.chats[index].name = newName;
          localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));
          renderSessions();
          attachSessionListeners();
        }
      });
    });

    document.querySelectorAll('.delete-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const groupName = btn.getAttribute('data-group');
        const index = btn.getAttribute('data-index');
        if (confirm('Are you sure you want to delete this session?')) {
          const group = groupedSessions.find(g => g.category === groupName);
          group.chats.splice(index, 1);
          localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));
          renderSessions();
          attachSessionListeners();
        }
      });
    });
  }

function switchSession(group, chat, index) {
    if (activeSessionId === chat.id) return; // ✅ Prevent duplicate triggers
    
    activeSessionId = chat.id;
    localStorage.setItem('kkh-active-session', activeSessionId);
    
    chatWindow.innerHTML = '';
    
    // Clear any existing follow-up suggestions when switching sessions
    document.querySelectorAll('.follow-up-container').forEach(container => {
      container.remove();
    });
    
    // Toggle input bar visibility based on session type
    if (activeSessionId.startsWith('quiz')) {
      chatForm.classList.add('quiz-session');
      document.body.classList.add('quiz-mode');
    } else {
      chatForm.classList.remove('quiz-session');
      document.body.classList.remove('quiz-mode');
    }
    
    // Load chat history first (this will restore saved prompts automatically)
    loadHistory();
    
    if (activeSessionId.startsWith('quiz')) {
      const savedQuiz = JSON.parse(localStorage.getItem('kkh-quiz-' + activeSessionId) || '[]');
      const savedAnswers = JSON.parse(localStorage.getItem('kkh-answers-' + activeSessionId) || '{}');
      const savedFeedback = JSON.parse(localStorage.getItem('kkh-quiz-feedback-' + activeSessionId) || '[]');
      
      if (savedQuiz.length > 0) {
        // Check if quiz was submitted (has feedback data)
        const quizWasSubmitted = savedFeedback.length > 0;
        
        savedQuiz.forEach((q, idx) => {
          const quizContainer = document.createElement('div');
          quizContainer.className = 'quiz-block';
          const questionText = document.createElement('p');
          questionText.innerHTML = `<strong>Q${idx + 1}:</strong> ${q.question}`;
          quizContainer.appendChild(questionText);
          
          q.options.slice(0, 5).forEach((opt, i) => {
            const wrapper = document.createElement('label');
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.margin = '4px 0';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `quiz-${idx}`;
            radio.value = opt;
            
            // Only disable if quiz was submitted, otherwise keep interactive
            radio.disabled = quizWasSubmitted;
            
            // Restore selected answers
            if (savedAnswers[idx] === opt) {
              radio.checked = true;
            }
            
            // Set up click handler for non-submitted quizzes
            if (!quizWasSubmitted) {
              radio.onclick = () => {
                quizAnswers[idx] = opt;
                // Save answers as user makes selections
                localStorage.setItem('kkh-answers-' + activeSessionId, JSON.stringify(quizAnswers));
              };
            }
            
            const text = document.createElement('span');
            text.textContent = `${String.fromCharCode(65 + i)}. ${opt}`;
            wrapper.appendChild(radio);
            wrapper.appendChild(text);
            
            // Only apply feedback coloring if quiz was submitted
            if (quizWasSubmitted && savedFeedback[idx]) {
              const feedback = savedFeedback[idx];
              if (opt === feedback.correctAnswer) {
                wrapper.style.background = '#c8facc'; // Green for correct answer
              }
              if (savedAnswers[idx] === opt && opt !== feedback.correctAnswer) {
                wrapper.style.background = '#ffc8c8'; // Red for wrong selected answer
              }
            }
            
            quizContainer.appendChild(wrapper);
          });
          
          // Only add explanation if quiz was submitted and answer was incorrect
          if (quizWasSubmitted && savedFeedback[idx] && !savedFeedback[idx].correct && savedFeedback[idx].explanation) {
            const explanation = document.createElement('div');
            explanation.style.marginTop = '8px';
            explanation.style.fontSize = '14px';
            explanation.innerHTML = `❌ <strong>Explanation:</strong> ${savedFeedback[idx].explanation}`;
            quizContainer.appendChild(explanation);
          }
          
          chatWindow.appendChild(quizContainer);
        });
        
        // Add submit button if quiz hasn't been submitted yet
        if (!quizWasSubmitted) {
          const submitBtn = document.createElement('button');
          submitBtn.textContent = 'Submit Quiz';
          submitBtn.className = 'sidebar-btn';
          submitBtn.style.marginTop = '1rem';
          submitBtn.onclick = async () => {
            await submitQuizAnswers();
          };
          chatWindow.appendChild(submitBtn);
        }
        
        // Initialize quizAnswers with saved answers for ongoing quizzes
        if (!quizWasSubmitted) {
          quizAnswers = { ...savedAnswers };
          currentQuiz = savedQuiz;
        }
      }
    }
    
    renderSessions();
    
    // Update active session highlighting
    updateActiveSessionHighlight();
    
    if (group.category === 'Quiz') {
      const existingQuiz = localStorage.getItem('kkh-quiz-' + activeSessionId);
      const savedTopic = localStorage.getItem('kkh-quiz-topic-' + activeSessionId);
      
      if (!existingQuiz || existingQuiz === '[]') {
        // No quiz exists for this session
        if (!savedTopic) {
          // No topic saved, show topic selection (for old sessions)
          showTopicSelection(chat.name);
        }
        // If topic exists but no quiz, it means we're in the process of creating/loading
        // the quiz (handled by createQuizSessionWithTopic), so don't show topic selection again
      } else {
        // Quiz exists, show restoration message
        const savedTopic = localStorage.getItem('kkh-quiz-topic-' + activeSessionId) || 'General';
        const savedFeedback = JSON.parse(localStorage.getItem('kkh-quiz-feedback-' + activeSessionId) || '[]');
        const quizStatus = savedFeedback.length > 0 ? 'completed' : 'in progress';
        
        const restoreMsg = document.createElement('div');
        restoreMsg.className = 'message bot';
        restoreMsg.innerHTML = `<span class="avatar">🤖</span><div class="message-content">📄 Restoring ${quizStatus} ${savedTopic} quiz: ${chat.name}</div>`;
        chatWindow.insertBefore(restoreMsg, chatWindow.firstChild);
        
        // Set up current quiz state for ongoing quizzes
        if (savedFeedback.length === 0) {
          const savedQuiz = JSON.parse(localStorage.getItem('kkh-quiz-' + activeSessionId) || '[]');
          const savedAnswers = JSON.parse(localStorage.getItem('kkh-answers-' + activeSessionId) || '{}');
          currentQuiz = savedQuiz;
          quizAnswers = { ...savedAnswers };
          currentQuizSessionId = activeSessionId; // Use session ID as quiz session ID for consistency
          console.log('[DEBUG] Restored quiz state - Session ID:', currentQuizSessionId);
        }
      }
    }
  }

  function loadHistory() {
    // Only clear and load history if not switching sessions (to avoid duplication)
    if (chatWindow.innerHTML === '') {
      const history = JSON.parse(localStorage.getItem('kkh-chat-history-' + activeSessionId) || '[]');
      if (history.length === 0) {
        // Only show welcome message for general sessions, not quiz sessions
        if (!activeSessionId.startsWith('quiz')) {
          appendGroupedMessage('bot', 'Hello! I am your KKH Nursing Chatbot. How can I assist you today?', false);
        }
      } else {
        history.forEach(msg => {
          if (!msg.text.startsWith("📄 Restoring previous quiz")) {
            // Check if message has saved prompts
            if (msg.prompts && Array.isArray(msg.prompts) && msg.prompts.length > 0) {
              appendGroupedMessage(msg.sender, msg.text, false, msg.prompts);
            } else {
              appendGroupedMessage(msg.sender, msg.text, false);
            }
          }
        });
      }
    } else {
      // If chat window has content, just append chat history (for quiz sessions)
      const history = JSON.parse(localStorage.getItem('kkh-chat-history-' + activeSessionId) || '[]');
      history.forEach(msg => {
        if (!msg.text.startsWith("📄 Restoring previous quiz")) {
          // Check if message has saved prompts
          if (msg.prompts && Array.isArray(msg.prompts) && msg.prompts.length > 0) {
            appendGroupedMessage(msg.sender, msg.text, false, msg.prompts);
          } else {
            appendGroupedMessage(msg.sender, msg.text, false);
          }
        }
      });
    }
  }

  function appendGroupedMessage(sender, text, save = true, prompts = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    const avatarSpan = document.createElement('span');
    avatarSpan.className = 'avatar';
    avatarSpan.textContent = avatars[sender];
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = text;
    messageDiv.appendChild(avatarSpan);
    messageDiv.appendChild(contentDiv);
    chatWindow.appendChild(messageDiv);
    
    // Add prompts if provided (only for bot messages in General sessions)
    if (prompts && prompts.length > 0 && sender === 'bot' && !activeSessionId.startsWith('quiz')) {
      const promptsContainer = createPromptsContainer(prompts);
      chatWindow.appendChild(promptsContainer);
    }
    
    chatWindow.scrollTop = chatWindow.scrollHeight;
    if (save) saveGroupedMessage(sender, text, prompts);
  }

  function saveGroupedMessage(sender, text, prompts = null) {
    if (!activeSessionId) {
      console.warn('No active session ID set.');
      return;
    }
    const key = 'kkh-chat-history-' + activeSessionId;
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    const messageData = { sender, text };
    
    // Add prompts if provided (only for bot messages in General sessions)
    if (prompts && prompts.length > 0 && sender === 'bot' && !activeSessionId.startsWith('quiz')) {
      messageData.prompts = prompts;
    }
    
    history.push(messageData);
    localStorage.setItem(key, JSON.stringify(history));
  }

  // Typing indicator
  function showTyping() {
    const typingDiv = document.createElement('div');
    typingDiv.id = 'typing-indicator';
    typingDiv.className = 'message bot';
    typingDiv.innerHTML = `<span class="avatar">🤖</span><div class="message-content">...</div>`;
    chatWindow.appendChild(typingDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
  function removeTyping() {
    const typingDiv = document.getElementById('typing-indicator');
    if (typingDiv) typingDiv.remove();
  }

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userText = userInput.value.trim();
    if (!userText) return;
    console.log('[User Submit]', userText, 'Session:', activeSessionId);
    
    // Auto-rename session if this is the first user message
    autoRenameSessionIfNeeded(userText);
    
    appendGroupedMessage('user', userText);
    userInput.value = '';
    const isQuiz = activeSessionId.startsWith('quiz');
    const url = isQuiz ? `${QUIZ_URL_FINAL}?prompt=${encodeURIComponent(userText)}` : BACKEND_URL_FINAL;
    const payload = isQuiz ? null : { question: userText, session: activeSessionId };
    const method = isQuiz ? 'GET' : 'POST';
    console.log('[Submit to]', url);
    console.log('[Payload]', payload);
    showTyping();
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined
      });
      const data = await res.json();
      removeTyping();
      
      let botResponse = '';
      if (data.full) {
        botResponse = data.full;
        appendGroupedMessage('bot', data.full);
      } else if (data.answer) {
        botResponse = data.answer;
        appendGroupedMessage('bot', data.answer);
      } else if (data.summary) {
        botResponse = data.summary;
        appendGroupedMessage('bot', data.summary);
      } else if (data.quiz) {
        appendGroupedMessage('bot', '📝 Quiz Loaded');
      } else if (data.response) {
        botResponse = data.response;
        appendGroupedMessage('bot', data.response);
      } else if (data.error) {
        appendGroupedMessage('bot', '❌ ' + data.error);
      } else {
        appendGroupedMessage('bot', '⚠️ Unexpected response from backend: ' + JSON.stringify(data));
      }
      
      // Add follow-up suggestions for General sessions only
      if (!isQuiz && botResponse) {
        createFollowUpSuggestions(userText);
      }
      
    } catch (err) {
      removeTyping();
      appendGroupedMessage('bot', '❌ Failed to reach server: ' + err.message);
    }
  });

  renderSessions();
  attachSessionListeners();
  loadHistory();
  
  // Initialize input bar visibility based on session type
  if (activeSessionId.startsWith('quiz')) {
    chatForm.classList.add('quiz-session');
    document.body.classList.add('quiz-mode');
  } else {
    chatForm.classList.remove('quiz-session');
    document.body.classList.remove('quiz-mode');
  }
  
  // Initialize active session highlighting
  updateActiveSessionHighlight();
  
  // Update active session highlighting
  function updateActiveSessionHighlight() {
    // Remove active class from all sessions
    document.querySelectorAll('.chat-session').forEach(session => {
      session.classList.remove('active');
    });
    
    // Add active class to current session
    const activeElement = document.getElementById(activeSessionId);
    if (activeElement) {
      activeElement.classList.add('active');
    }
  }

  // Function to create follow-up suggestions for General sessions
  async function createFollowUpSuggestions(userInput) {
    // Remove any existing follow-up containers to avoid clutter
    document.querySelectorAll('.follow-up-container').forEach(container => {
      container.remove();
    });
    
    // Check cache first
    const cacheKey = `kkh-suggestions-${activeSessionId}-${userInput.toLowerCase().trim()}`;
    const cachedSuggestions = localStorage.getItem(cacheKey);
    
    if (cachedSuggestions) {
      const suggestions = JSON.parse(cachedSuggestions);
      displaySuggestions(suggestions);
      return;
    }
    
    // Show loading indicator for suggestions
    const loadingContainer = createLoadingContainer();
    chatWindow.appendChild(loadingContainer);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    
    try {
      const response = await fetch(SUGGEST_URL_FINAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userInput })
      });
      
      const data = await response.json();
      
      // Remove loading indicator
      loadingContainer.remove();
      
      if (data.suggestions && Array.isArray(data.suggestions)) {
        // Cache the suggestions
        localStorage.setItem(cacheKey, JSON.stringify(data.suggestions));
        displaySuggestions(data.suggestions);
      } else if (data.error) {
        console.error('Suggestion error:', data.error);
        // Show fallback suggestions
        displaySuggestions(getFallbackSuggestions());
      }
      
    } catch (error) {
      console.error('Error fetching suggestions:', error);
      // Remove loading indicator
      loadingContainer.remove();
      // Show fallback suggestions
      displaySuggestions(getFallbackSuggestions());
    }
  }

  // Function to create loading container for suggestions
  function createLoadingContainer() {
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'follow-up-container loading';
    loadingContainer.style.marginTop = '0.75rem';
    loadingContainer.style.padding = '0.75rem';
    loadingContainer.style.backgroundColor = '#f8f9fa';
    loadingContainer.style.borderRadius = '8px';
    loadingContainer.style.border = '1px solid #e9ecef';
    loadingContainer.style.opacity = '0';
    loadingContainer.style.animation = 'fadeIn 0.3s ease forwards';
    
    const headerText = document.createElement('p');
    headerText.innerHTML = '<strong>💡 Generating related questions...</strong>';
    headerText.style.margin = '0 0 0.5rem 0';
    headerText.style.fontSize = '13px';
    headerText.style.color = '#666';
    loadingContainer.appendChild(headerText);
    
    const dotsContainer = document.createElement('div');
    dotsContainer.style.display = 'flex';
    dotsContainer.style.gap = '0.5rem';
    
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.backgroundColor = '#4caf50';
      dot.style.borderRadius = '50%';
      dot.style.animation = `pulse 1.5s ease-in-out ${i * 0.2}s infinite`;
      dotsContainer.appendChild(dot);
    }
    
    loadingContainer.appendChild(dotsContainer);
    
    // Add CSS animations if not already added
    if (!document.querySelector('#suggestion-animations')) {
      const style = document.createElement('style');
      style.id = 'suggestion-animations';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `;
      document.head.appendChild(style);
    }
    
    return loadingContainer;
  }

  // Function to display suggestions with animation
  function displaySuggestions(suggestions) {
    if (!suggestions || suggestions.length === 0) return;
    
    // Store prompts with the last bot message for General sessions only
    if (!activeSessionId.startsWith('quiz')) {
      updateLastBotMessageWithPrompts(suggestions);
    }
    
    const followUpContainer = document.createElement('div');
    followUpContainer.className = 'follow-up-container';
    followUpContainer.style.marginTop = '0.75rem';
    followUpContainer.style.padding = '0.75rem';
    followUpContainer.style.backgroundColor = '#f8f9fa';
    followUpContainer.style.borderRadius = '8px';
    followUpContainer.style.border = '1px solid #e9ecef';
    followUpContainer.style.opacity = '0';
    followUpContainer.style.animation = 'fadeIn 0.3s ease forwards';
    
    const headerText = document.createElement('p');
    headerText.innerHTML = '<strong>💡 Related questions you might ask:</strong>';
    headerText.style.margin = '0 0 0.5rem 0';
    headerText.style.fontSize = '13px';
    headerText.style.color = '#666';
    followUpContainer.appendChild(headerText);
    
    suggestions.forEach((suggestion, index) => {
      const followUpBtn = document.createElement('button');
      followUpBtn.className = 'follow-up-btn';
      followUpBtn.textContent = suggestion;
      followUpBtn.style.display = 'inline-block';
      followUpBtn.style.margin = '0.25rem 0.25rem 0.25rem 0';
      followUpBtn.style.padding = '0.4rem 0.8rem';
      followUpBtn.style.backgroundColor = '#e8f5e8';
      followUpBtn.style.border = '1px solid #4caf50';
      followUpBtn.style.borderRadius = '20px';
      followUpBtn.style.cursor = 'pointer';
      followUpBtn.style.fontSize = '12px';
      followUpBtn.style.transition = 'all 0.2s ease';
      followUpBtn.style.color = '#2e7d32';
      followUpBtn.style.fontWeight = '500';
      followUpBtn.style.opacity = '0';
      followUpBtn.style.animation = `slideIn 0.3s ease ${index * 0.1}s forwards`;
      
      followUpBtn.addEventListener('mouseover', () => {
        followUpBtn.style.backgroundColor = '#c8e6c9';
        followUpBtn.style.transform = 'translateY(-1px)';
      });
      
      followUpBtn.addEventListener('mouseout', () => {
        followUpBtn.style.backgroundColor = '#e8f5e8';
        followUpBtn.style.transform = 'translateY(0)';
      });
      
      followUpBtn.addEventListener('click', () => {
        submitFollowUpQuestion(suggestion);
      });
      
      followUpContainer.appendChild(followUpBtn);
    });
    
    chatWindow.appendChild(followUpContainer);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  // Function to get fallback suggestions
  function getFallbackSuggestions() {
    return [
      "Can you explain more about this topic?",
      "What are the key nursing considerations?",
      "When should I seek medical help?"
    ];
  }

  // Function to submit follow-up questions
  async function submitFollowUpQuestion(question) {
    // Remove follow-up containers to avoid clutter
    document.querySelectorAll('.follow-up-container').forEach(container => {
      container.remove();
    });
    
    // Add user message
    appendGroupedMessage('user', question);
    
    // Show typing indicator
    showTyping();
    
    try {
      const isQuiz = activeSessionId.startsWith('quiz');
      const url = isQuiz ? `${QUIZ_URL_FINAL}?prompt=${encodeURIComponent(question)}` : BACKEND_URL_FINAL;
      const payload = isQuiz ? null : { question: question, session: activeSessionId };
      const method = isQuiz ? 'GET' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined
      });
      
      const data = await res.json();
      removeTyping();
      
      let botResponse = '';
      if (data.full) {
        botResponse = data.full;
        appendGroupedMessage('bot', data.full);
      } else if (data.answer) {
        botResponse = data.answer;
        appendGroupedMessage('bot', data.answer);
      } else if (data.summary) {
        botResponse = data.summary;
        appendGroupedMessage('bot', data.summary);
      } else if (data.response) {
        botResponse = data.response;
        appendGroupedMessage('bot', data.response);
      } else if (data.error) {
        appendGroupedMessage('bot', '❌ ' + data.error);
      } else {
        appendGroupedMessage('bot', '⚠️ Unexpected response from backend: ' + JSON.stringify(data));
      }
      
      // Add follow-up suggestions for subsequent responses too
      if (!isQuiz && botResponse) {
        createFollowUpSuggestions(question);
      }
      
    } catch (err) {
      removeTyping();
      appendGroupedMessage('bot', '❌ Failed to reach server: ' + err.message);
    }
  }

  // Function to submit quiz answers
  async function submitQuizAnswers() {
    if (!currentQuiz || currentQuiz.length === 0) {
      console.error('No current quiz to submit');
      return;
    }
    
    const userResponses = currentQuiz.map((q, i) => ({
      question: q.question,
      answer: quizAnswers[i] || ''
    }));
    
    console.log('[DEBUG] Submitting quiz answers:');
    console.log('[DEBUG] Session ID:', currentQuizSessionId);
    console.log('[DEBUG] Number of responses:', userResponses.length);
    console.log('[DEBUG] User responses:', userResponses);
    
    try {
      const result = await fetch(QUIZ_EVAL_URL_FINAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          session_id: currentQuizSessionId || `quiz-${Date.now()}`,
          responses: userResponses
        })
      });
      
      const feedback = await result.json();
      let score = 0;
      
      feedback.forEach((item, i) => {
        const block = document.querySelectorAll('.quiz-block')[i];
        const inputs = block.querySelectorAll('input');
        const explanation = document.createElement('div');
        explanation.style.marginTop = '8px';
        explanation.style.fontSize = '14px';
        
        // Disable all inputs after submission
        inputs.forEach(input => {
          input.disabled = true;
          if (input.value === item.correctAnswer) {
            input.parentElement.style.background = '#c8facc';
          }
          if (input.checked && input.value !== item.correctAnswer) {
            input.parentElement.style.background = '#ffc8c8';
          }
        });
        
        if (item.correct) score++;
        if (!item.correct) {
          explanation.innerHTML = `❌ <strong>Explanation:</strong> ${item.explanation || 'Refer to nursing guide for details.'}`;
          block.appendChild(explanation);
        }
      });
      
      // Save all quiz data
      localStorage.setItem('kkh-quiz-feedback-' + activeSessionId, JSON.stringify(feedback));
      localStorage.setItem('kkh-quiz-' + activeSessionId, JSON.stringify(currentQuiz));
      localStorage.setItem('kkh-answers-' + activeSessionId, JSON.stringify(quizAnswers));
      
      // Remove submit button after submission
      document.querySelectorAll('.sidebar-btn').forEach(btn => {
        if (btn.textContent === 'Submit Quiz') {
          btn.remove();
        }
      });
      
      const topic = localStorage.getItem('kkh-quiz-topic-' + activeSessionId) || 'General';
      appendGroupedMessage('bot', `✅ You scored ${score} out of ${currentQuiz.length} on the ${topic} quiz!`);
      
    } catch (error) {
      console.error('Error submitting quiz:', error);
      appendGroupedMessage('bot', '❌ Failed to submit quiz. Please try again.');
    }
  }
  
  // Global event listeners for quiz action buttons using event delegation
  document.addEventListener('click', (e) => {
    // Event delegation for other dynamic buttons can be added here if needed
  });
  
  // Function to create prompts container for saved messages
  function createPromptsContainer(prompts) {
    const promptsContainer = document.createElement('div');
    promptsContainer.className = 'follow-up-container saved-prompts';
    promptsContainer.style.marginTop = '0.75rem';
    promptsContainer.style.padding = '0.75rem';
    promptsContainer.style.backgroundColor = '#f8f9fa';
    promptsContainer.style.borderRadius = '8px';
    promptsContainer.style.border = '1px solid #e9ecef';
    
    const headerText = document.createElement('p');
    headerText.innerHTML = '<strong>💡 Related questions you might ask:</strong>';
    headerText.style.margin = '0 0 0.5rem 0';
    headerText.style.fontSize = '13px';
    headerText.style.color = '#666';
    promptsContainer.appendChild(headerText);
    
    prompts.forEach((prompt, index) => {
      const promptBtn = document.createElement('button');
      promptBtn.className = 'follow-up-btn saved-prompt-btn';
      promptBtn.textContent = prompt;
      promptBtn.style.display = 'inline-block';
      promptBtn.style.margin = '0.25rem 0.25rem 0.25rem 0';
      promptBtn.style.padding = '0.4rem 0.8rem';
      promptBtn.style.backgroundColor = '#e8f5e8';
      promptBtn.style.border = '1px solid #4caf50';
      promptBtn.style.borderRadius = '20px';
      promptBtn.style.cursor = 'pointer';
      promptBtn.style.fontSize = '12px';
      promptBtn.style.transition = 'all 0.2s ease';
      promptBtn.style.color = '#2e7d32';
      promptBtn.style.fontWeight = '500';
      
      promptBtn.addEventListener('mouseover', () => {
        promptBtn.style.backgroundColor = '#c8e6c9';
        promptBtn.style.transform = 'translateY(-1px)';
      });
      
      promptBtn.addEventListener('mouseout', () => {
        promptBtn.style.backgroundColor = '#e8f5e8';
        promptBtn.style.transform = 'translateY(0)';
      });
      
      promptBtn.addEventListener('click', () => {
        submitFollowUpQuestion(prompt);
      });
      
      promptsContainer.appendChild(promptBtn);
    });
    
    return promptsContainer;
  }
  
  // Function to update the last bot message with prompts in chat history
  function updateLastBotMessageWithPrompts(prompts) {
    if (!activeSessionId || activeSessionId.startsWith('quiz')) return;
    
    const key = 'kkh-chat-history-' + activeSessionId;
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    
    // Find the last bot message and add prompts to it
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].sender === 'bot') {
        // Only add prompts if they don't already exist
        if (!history[i].prompts) {
          history[i].prompts = prompts;
          localStorage.setItem(key, JSON.stringify(history));
        }
        break;
      }
    }
  }

  // Function to show topic selection for quiz
  function showTopicSelection(chatName) {
    appendGroupedMessage('bot', `📝 Starting quiz session: ${chatName}. Please select a topic:`);
    
    const topicContainer = document.createElement('div');
    topicContainer.className = 'topic-selection-container';
    topicContainer.style.marginTop = '1rem';
    topicContainer.style.padding = '1rem';
    topicContainer.style.backgroundColor = '#f8f9fa';
    topicContainer.style.borderRadius = '8px';
    topicContainer.style.border = '1px solid #e9ecef';
    
    const headerText = document.createElement('p');
    headerText.innerHTML = '<strong>🎯 Choose a quiz topic:</strong>';
    headerText.style.margin = '0 0 1rem 0';
    headerText.style.fontSize = '14px';
    headerText.style.color = '#333';
    topicContainer.appendChild(headerText);
    
    const topics = [
      'General Nursing',
      'Fever Management',
      'CPR & Emergency Care',
      'Dehydration',
      'Pain Management',
      'Medication Administration',
      'Infection Control',
      'Pediatric Care',
      'Wound Care',
      'Cardiac Care'
    ];
    
    topics.forEach((topic, index) => {
      const topicBtn = document.createElement('button');
      topicBtn.className = 'topic-btn';
      topicBtn.textContent = topic;
      topicBtn.style.display = 'inline-block';
      topicBtn.style.margin = '0.25rem 0.5rem 0.25rem 0';
      topicBtn.style.padding = '0.6rem 1rem';
      topicBtn.style.backgroundColor = '#e3f2fd';
      topicBtn.style.border = '1px solid #2196f3';
      topicBtn.style.borderRadius = '8px';
      topicBtn.style.cursor = 'pointer';
      topicBtn.style.fontSize = '13px';
      topicBtn.style.transition = 'all 0.2s ease';
      topicBtn.style.color = '#1976d2';
      topicBtn.style.fontWeight = '500';
      
      topicBtn.addEventListener('mouseover', () => {
        topicBtn.style.backgroundColor = '#bbdefb';
        topicBtn.style.transform = 'translateY(-1px)';
      });
      
      topicBtn.addEventListener('mouseout', () => {
        topicBtn.style.backgroundColor = '#e3f2fd';
        topicBtn.style.transform = 'translateY(0)';
      });
      
      topicBtn.addEventListener('click', () => {
        startQuizWithTopic(topic);
      });
      
      topicContainer.appendChild(topicBtn);
    });
    
    chatWindow.appendChild(topicContainer);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }
  
  // Function to start quiz with selected topic
  function startQuizWithTopic(topic) {
    // Remove topic selection container
    document.querySelectorAll('.topic-selection-container').forEach(container => {
      container.remove();
    });
    
    // Save selected topic to localStorage
    localStorage.setItem('kkh-quiz-topic-' + activeSessionId, topic);
    
    appendGroupedMessage('bot', `🎯 Starting ${topic} quiz. Loading questions...`);
    
    // Abort any existing quiz fetch request
    if (quizFetchController) {
      quizFetchController.abort();
    }
    quizFetchController = new AbortController();
    
    // Load quiz questions for this session with the selected topic
    const topicParam = encodeURIComponent(topic);
    const sessionParam = encodeURIComponent(activeSessionId);
    fetch(`${QUIZ_URL_FINAL}?n=10&topic=${topicParam}&session_id=${sessionParam}`, {
      signal: quizFetchController.signal
    })
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        console.log("QUIZ FETCH RESPONSE", data);
        
        // Check for error in response first
        if (data.error) {
          console.error("Backend error:", data.error);
          appendGroupedMessage('bot', `❌ ${data.error}`);
          return;
        }
        
        // Handle different possible response formats
        let quizData = null;
        if (data.quiz && Array.isArray(data.quiz) && data.quiz.length > 0) {
          quizData = data.quiz;
          console.log("Found valid quiz data:", quizData.length, "questions");
        } else {
          console.error("Invalid quiz data format:", data);
          console.error("Available keys:", Object.keys(data));
          appendGroupedMessage('bot', '❌ Unable to load quiz questions. Server may not be connected to LM Studio or returned invalid data.');
          return;
        }

        if (quizData && quizData.length > 0) {
          appendGroupedMessage('bot', `📝 Here are your ${topic} quiz questions:`);
          currentQuiz = quizData;
          currentQuizSessionId = data.session_id || `quiz-${Date.now()}`;
          
          // Initialize quiz answers object
          quizAnswers = {};
          
          // Save quiz data to localStorage
          localStorage.setItem('kkh-quiz-' + activeSessionId, JSON.stringify(quizData));
          
          quizData.forEach((q, idx) => {
            const quizContainer = document.createElement('div');
            quizContainer.className = 'quiz-block';
            const questionText = document.createElement('p');
            
            // Handle different question formats
            const question = q.question || q.text || q.prompt || q;
            if (!question || typeof question !== 'string') {
              console.error(`Invalid question at index ${idx}:`, q);
              return;
            }
            
            questionText.innerHTML = `<strong>Q${idx + 1}:</strong> ${question}`;
            quizContainer.appendChild(questionText);
            
            // Handle different options formats
            let options = [];
            if (q.options && Array.isArray(q.options)) {
              options = q.options;
            } else if (q.choices && Array.isArray(q.choices)) {
              options = q.choices;
            } else if (q.option1 && q.option2 && q.option3 && q.option4) {
              // Handle option1, option2, option3, option4 format
              options = [q.option1, q.option2, q.option3, q.option4];
            } else {
              console.error(`No valid options found for question ${idx + 1}:`, q);
              options = ['Option A', 'Option B', 'Option C', 'Option D'];
            }
            
            options.slice(0, 5).forEach((opt, i) => {
              const wrapper = document.createElement('label');
              wrapper.style.display = 'flex';
              wrapper.style.alignItems = 'center';
              wrapper.style.margin = '4px 0';
              const radio = document.createElement('input');
              radio.type = 'radio';
              radio.name = `quiz-${idx}`;
              radio.value = opt;
              radio.style.marginRight = '10px';
              radio.onclick = () => {
                quizAnswers[idx] = opt;
                // Save answers as user makes selections
                localStorage.setItem('kkh-answers-' + activeSessionId, JSON.stringify(quizAnswers));
              };
              const text = document.createElement('span');
              const optionText = typeof opt === 'string' ? opt : opt.text || JSON.stringify(opt);
              text.textContent = `${String.fromCharCode(65 + i)}. ${optionText}`;
              radio.value = optionText;
              wrapper.appendChild(radio);
              wrapper.appendChild(text);
              quizContainer.appendChild(wrapper);
            });
            chatWindow.appendChild(quizContainer);
          });
          
          const submitBtn = document.createElement('button');
          submitBtn.textContent = 'Submit Quiz';
          submitBtn.className = 'sidebar-btn';
          submitBtn.style.marginTop = '1rem';
          submitBtn.onclick = async () => {
            await submitQuizAnswers();
          };
          chatWindow.appendChild(submitBtn);
          chatWindow.scrollTop = chatWindow.scrollHeight;
        } else {
          appendGroupedMessage('bot', '❌ No quiz questions received from the server.');
        }
      })
      .catch(error => {
        console.error('Error fetching quiz:', error);
        // Don't show error message if request was aborted
        if (error.name === 'AbortError') {
          console.log('Quiz fetch was aborted');
          return;
        }
        if (error.message.includes('Failed to fetch')) {
          appendGroupedMessage('bot', `❌ Cannot connect to backend server. Please ensure the backend is running on port 8000.`);
        } else if (error.message.includes('HTTP error')) {
          appendGroupedMessage('bot', `❌ Backend server error: ${error.message}. Please check if LM Studio is running.`);
        } else {
          appendGroupedMessage('bot', `❌ Failed to load quiz: ${error.message}`);
        }
      });
  }
  
  // Function to show topic selection when creating a new quiz session
  function showTopicSelectionForNewSession(group) {
    // Create a modal-like overlay for topic selection
    const overlay = document.createElement('div');
    overlay.className = 'topic-selection-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '1000';
    
    const modal = document.createElement('div');
    modal.style.backgroundColor = 'white';
    modal.style.padding = '2rem';
    modal.style.borderRadius = '12px';
    modal.style.maxWidth = '600px';
    modal.style.width = '90%';
    modal.style.maxHeight = '80vh';
    modal.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.3)';
    modal.style.overflow = 'hidden';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    
    const title = document.createElement('h3');
    title.textContent = '🎯 Choose Quiz Topic';
    title.style.margin = '0 0 0.5rem 0';
    title.style.fontSize = '1.3rem';
    title.style.color = '#1976d2';
    title.style.textAlign = 'center';
    title.style.fontWeight = '700';
    modal.appendChild(title);
    
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Select a topic for your new quiz session:';
    subtitle.style.margin = '0 0 1.5rem 0';
    subtitle.style.fontSize = '0.95rem';
    subtitle.style.color = '#666';
    subtitle.style.textAlign = 'center';
    subtitle.style.lineHeight = '1.4';
    modal.appendChild(subtitle);
    
    const topicContainer = document.createElement('div');
    topicContainer.style.display = 'grid';
    topicContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(150px, 1fr))';
    topicContainer.style.gap = '0.8rem';
    topicContainer.style.marginBottom = '1.5rem';
    topicContainer.style.maxHeight = '300px';
    topicContainer.style.overflowY = 'auto';
    
    const topics = [
      'General Nursing',
      'Fever Management',
      'CPR & Emergency Care',
      'Dehydration',
      'Pain Management',
      'Medication Administration',
      'Infection Control',
      'Pediatric Care',
      'Wound Care',
      'Cardiac Care',
      'Calculations',
      'Growth & Development',
      'Nutrition',
      'Vital Signs',
      'Communication Skills',
      'Neonatal Care',
      'Mental Health',
      'Respiratory Care',
      'Diabetes Management',
      'Post-Operative Care'
    ];
    
    topics.forEach(topic => {
      const topicBtn = document.createElement('button');
      topicBtn.className = 'topic-btn';
      topicBtn.textContent = topic;
      topicBtn.style.padding = '0.8rem 1rem';
      topicBtn.style.backgroundColor = '#e3f2fd';
      topicBtn.style.border = '2px solid #2196f3';
      topicBtn.style.borderRadius = '10px';
      topicBtn.style.cursor = 'pointer';
      topicBtn.style.fontSize = '13px';
      topicBtn.style.transition = 'all 0.3s ease';
      topicBtn.style.color = '#1976d2';
      topicBtn.style.fontWeight = '600';
      topicBtn.style.textAlign = 'center';
      topicBtn.style.position = 'relative';
      topicBtn.style.overflow = 'hidden';
      
      topicBtn.addEventListener('mouseover', () => {
        topicBtn.style.backgroundColor = '#1976d2';
        topicBtn.style.color = 'white';
        topicBtn.style.transform = 'translateY(-2px)';
        topicBtn.style.boxShadow = '0 4px 12px rgba(25, 118, 210, 0.3)';
      });
      
      topicBtn.addEventListener('mouseout', () => {
        topicBtn.style.backgroundColor = '#e3f2fd';
        topicBtn.style.color = '#1976d2';
        topicBtn.style.transform = 'translateY(0)';
        topicBtn.style.boxShadow = 'none';
      });
      
      topicBtn.addEventListener('click', () => {
        createQuizSessionWithTopic(group, topic);
        document.body.removeChild(overlay);
      });
      
      topicContainer.appendChild(topicBtn);
    });
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '0.8rem 2rem';
    cancelBtn.style.backgroundColor = '#f5f5f5';
    cancelBtn.style.border = '2px solid #ddd';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.fontSize = '14px';
    cancelBtn.style.color = '#666';
    cancelBtn.style.display = 'block';
    cancelBtn.style.margin = '0 auto';
    cancelBtn.style.transition = 'all 0.2s ease';
    cancelBtn.style.fontWeight = '500';
    
    cancelBtn.addEventListener('mouseover', () => {
      cancelBtn.style.backgroundColor = '#e0e0e0';
      cancelBtn.style.borderColor = '#bbb';
    });
    
    cancelBtn.addEventListener('mouseout', () => {
      cancelBtn.style.backgroundColor = '#f5f5f5';
      cancelBtn.style.borderColor = '#ddd';
    });
    
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });
    
    // Close on Escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Add media query for mobile responsiveness
    const style = document.createElement('style');
    style.textContent = `
      @media (max-width: 480px) {
        .topic-selection-overlay .topic-btn {
          font-size: 12px !important;
          padding: 0.6rem 0.8rem !important;
        }
      }
    `;
    document.head.appendChild(style);
    
    modal.appendChild(topicContainer);
    modal.appendChild(cancelBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // Function to create a new quiz session with topic-based title
  function createQuizSessionWithTopic(group, topic) {
    const newChat = {
      id: `quiz-${Date.now()}`,
      name: `Quiz: ${topic}`
    };

    group.chats.push(newChat);
    localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));
    
    // Save the topic for this session
    localStorage.setItem('kkh-quiz-topic-' + newChat.id, topic);
    
    renderSessions();
    attachSessionListeners();
    
    // Switch to the new session and start the quiz
    const chatIndex = group.chats.length - 1;
    switchSession(group, newChat, chatIndex);
    
    // Start quiz generation immediately since we already have the topic
    startQuizWithTopic(topic);
  }
  
  // Migration function to update existing quiz session names
  function migrateExistingQuizSessions() {
    let needsUpdate = false;
    
    groupedSessions.forEach(group => {
      if (group.category === 'Quiz') {
        group.chats.forEach(chat => {
          // Check if this is an old-style quiz session name
          if (chat.name.startsWith('Quiz Attempt') && !chat.name.startsWith('Quiz:')) {
            const savedTopic = localStorage.getItem('kkh-quiz-topic-' + chat.id);
            if (savedTopic) {
              // Update name to use topic
              chat.name = `Quiz: ${savedTopic}`;
              needsUpdate = true;
            } else {
              // No topic saved, set a default
              localStorage.setItem('kkh-quiz-topic-' + chat.id, 'General Nursing');
              chat.name = 'Quiz: General Nursing';
              needsUpdate = true;
            }
          }
        });
      }
    });
    
    if (needsUpdate) {
      localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));
      console.log('[DEBUG] Migrated existing quiz sessions to use topic-based titles');
    }
  }

  // Function to generate session name from user message
  function generateSessionName(userText) {
    // Clean up the text - remove extra whitespace and common prefixes
    let cleanText = userText.trim()
      .replace(/^(how\s+(to|do\s+i|can\s+i)\s+)/i, '') // Remove "how to", "how do I", "how can I"
      .replace(/^(what\s+(is|are)\s+)/i, '') // Remove "what is", "what are"
      .replace(/^(can\s+you\s+)/i, '') // Remove "can you"
      .replace(/^(please\s+)/i, '') // Remove "please"
      .replace(/\?+$/, ''); // Remove trailing question marks
    
    // Take the first 5-8 words and clean them up
    const words = cleanText.split(/\s+/).slice(0, 8);
    let sessionName = words.join(' ');
    
    // Trim to reasonable length (max 60 characters)
    if (sessionName.length > 60) {
      sessionName = sessionName.substring(0, 57) + '...';
    }
    
    // Capitalize first letter and ensure it's not empty
    if (sessionName.length === 0) {
      sessionName = 'New conversation';
    } else {
      sessionName = sessionName.charAt(0).toUpperCase() + sessionName.slice(1);
    }
    
    // Return the session name without any prefix
    return sessionName;
  }

  // Function to auto-rename session based on first user message
  function autoRenameSessionIfNeeded(userText) {
    // Only rename General sessions, not quiz sessions
    if (activeSessionId.startsWith('quiz')) return;
    
    // Check if this is the first user message in the session
    const history = JSON.parse(localStorage.getItem('kkh-chat-history-' + activeSessionId) || '[]');
    const userMessages = history.filter(msg => msg.sender === 'user');
    
    // Only rename if this will be the first user message (before it's added to history)
    if (userMessages.length !== 0) return;
    
    // Find the current session in groupedSessions
    const group = groupedSessions.find(g => g.category === 'General');
    if (!group) return;
    
    const chat = group.chats.find(c => c.id === activeSessionId);
    if (!chat) return;
    
    // Only rename if it's still using default naming pattern
    const defaultNamePattern = /^Chat \d+$/;
    if (!defaultNamePattern.test(chat.name)) return;
    
    // Generate new name and update
    const newName = generateSessionName(userText);
    chat.name = newName;
    
    // Save updated sessions to localStorage
    localStorage.setItem('kkh-grouped-sessions', JSON.stringify(groupedSessions));
    
    // Re-render sessions to show updated name
    renderSessions();
    attachSessionListeners();
    updateActiveSessionHighlight();
    
    console.log(`[Auto-rename] Session renamed to "${newName}"`);
  }

  // Run migration on page load
  migrateExistingQuizSessions();
});