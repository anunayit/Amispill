import { useState, useEffect } from 'react'
import './App.css'
import { auth, db } from './firebase' 
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged,
  signOut,
  updateProfile,
  sendEmailVerification 
} from 'firebase/auth'
import { 
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, 
  doc, updateDoc, deleteDoc, arrayUnion, arrayRemove, where, getDocs, setDoc 
} from 'firebase/firestore'
import axios from 'axios'
import { formatDistanceToNow } from 'date-fns'
import imageCompression from 'browser-image-compression'
import html2canvas from 'html2canvas' // <--- NEW IMPORT

// --- CONFIGURATION ---
const CLOUD_NAME = "deselr0np"; 
const UPLOAD_PRESET = "amity_uploads"; 
const ADMIN_EMAILS = ["anunay.kumar@s.amity.edu"]; 

function App() {
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [isLogin, setIsLogin] = useState(true)
  
  const [currentPage, setCurrentPage] = useState('feed') 
  const [activeTab, setActiveTab] = useState('feed') 

  const [postText, setPostText] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [posts, setPosts] = useState([])
  const [profilePicFile, setProfilePicFile] = useState(null)

  // --- 1. AUTH STATE ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
      } else {
        setUser(null);
      }
    })
    return () => unsubscribe()
  }, [])

  // --- 2. DATA FETCHING ---
  useEffect(() => {
    if (!user) return;
    
    let q;
    if (currentPage === 'profile') {
      q = query(collection(db, "posts"), where("uid", "==", user.uid), orderBy("createdAt", "desc"));
    } else {
      q = query(
        collection(db, "posts"), 
        where("type", "==", activeTab), 
        orderBy("createdAt", "desc")
      );
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const fetchedPosts = snapshot.docs
        .map(doc => {
          const data = doc.data();
          return { 
            id: doc.id, 
            ...data,
            createdAt: data.createdAt || { toDate: () => new Date() } 
          };
        })
        .filter(post => !post.reports || !post.reports.includes(user.uid));

      setPosts(fetchedPosts);
    }, (error) => {
      console.log("Firestore Error:", error);
    });
    return () => unsub()
  }, [user, activeTab, currentPage])

  // --- 3. LIVE TIMESTAMP TICKER (NEW) ---
  // Forces the "5 mins ago" text to update every 60 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setPosts(prev => [...prev]); // Trigger re-render
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // --- 4. HANDLE AUTH ---
  const handleAuth = async (e) => {
    e.preventDefault()
    setError('')
    
    const cleanEmail = email.trim(); 
    const cleanUsername = username.trim();

    if (isLogin) {
      let loginIdentifier = cleanEmail;

      if (!loginIdentifier.includes('@')) {
          try {
            const q = query(collection(db, "users"), where("username", "==", loginIdentifier));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
              setError("❌ Username not found. Try logging in with Email.");
              return;
            }
            loginIdentifier = querySnapshot.docs[0].data().email;
          } catch (err) {
            setError("Error finding username.");
            return;
          }
      }

      try {
        await signInWithEmailAndPassword(auth, loginIdentifier, password);
      } catch (err) {
        setError("❌ Wrong password or account not found.");
      }
    } else {
      if (!cleanEmail.endsWith('@s.amity.edu')) {
        setError('❌ Only @s.amity.edu emails allowed.')
        return
      }
      if (cleanUsername === "") { setError("Username required"); return; }
      
      try {
        const q = query(collection(db, "users"), where("username", "==", cleanUsername));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            setError("⚠️ Username already taken! Please choose another.");
            return;
        }

        const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, password)
        const newUser = userCredential.user;

        await setDoc(doc(db, "users", newUser.uid), {
          username: cleanUsername,
          email: cleanEmail,
          uid: newUser.uid,
          createdAt: new Date()
        });

        await updateProfile(newUser, { displayName: cleanUsername })
        await sendEmailVerification(newUser); 
        alert("✅ Account created! Check inbox.");

      } catch (err) { setError(err.message) }
    }
  }

  // --- ACTIONS ---
  const compressImage = async (file) => {
    const options = { maxSizeMB: 0.5, maxWidthOrHeight: 1920, useWebWorker: true }
    try { return await imageCompression(file, options); } 
    catch (err) { return file; }
  }

  const uploadToCloudinary = async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", UPLOAD_PRESET); 
    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      formData
    );
    return response.data.secure_url;
  }

  const handlePost = async () => {
    if (!postText.trim() && !imageFile) {
      alert("⚠️ Write something or add a photo!");
      return;
    }
    setIsUploading(true);

    const tempId = Date.now().toString(); 
    const postType = activeTab; 
    const authorName = postType === 'confessions' ? "Anonymous Student" : (user.displayName || "Student");
    const authorPic = postType === 'confessions' ? null : user.photoURL;
    const timestamp = new Date();
    
    let tempImageUrl = "";
    if (imageFile) {
      tempImageUrl = URL.createObjectURL(imageFile);
    }

    const newPost = {
      id: tempId,
      text: postText,
      imageUrl: tempImageUrl,
      author: authorName,
      authorPic: authorPic,
      uid: user.uid,
      likes: [],
      reports: [], 
      type: postType,
      createdAt: { toDate: () => timestamp } 
    };

    setPosts((prev) => [newPost, ...prev]); 
    setPostText('');
    setImageFile(null);

    try {
      let finalImageUrl = "";
      if (imageFile) {
        const compressed = await compressImage(imageFile);
        finalImageUrl = await uploadToCloudinary(compressed);
      }

      await addDoc(collection(db, "posts"), {
        text: newPost.text,
        imageUrl: finalImageUrl || "", 
        author: authorName,
        authorPic: authorPic,
        uid: user.uid,
        likes: [],
        reports: [], 
        type: postType,
        createdAt: timestamp
      })
      setIsUploading(false);
    } catch (err) {
      console.error(err);
      setIsUploading(false);
    }
  }

  const updateProfilePic = async () => {
    if (!profilePicFile) return;
    setIsUploading(true);
    try {
      const compressed = await compressImage(profilePicFile);
      const url = await uploadToCloudinary(compressed);
      await updateProfile(user, { photoURL: url });
      alert("Updated!");
      setProfilePicFile(null);
      setIsUploading(false);
      window.location.reload(); 
    } catch (err) { setIsUploading(false); }
  }

  const deletePost = async (postId) => {
    if (window.confirm("Admin: Delete this post?")) {
      await deleteDoc(doc(db, "posts", postId));
    }
  }

  const reportPost = async (postId) => {
    if (window.confirm("🚩 Report this post as inappropriate? It will be hidden for you.")) {
      setPosts(prev => prev.filter(p => p.id !== postId));
      const postRef = doc(db, "posts", postId);
      await updateDoc(postRef, { reports: arrayUnion(user.uid) });
    }
  }

  // --- SMART SHARE LOGIC (NEW) ---
  const handleShare = async (post) => {
    const postElement = document.getElementById(`post-${post.id}`);
    
    if (!postElement) {
        // Fallback if element not found
        handleCopyLink(post);
        return;
    }

    try {
      // Create a canvas from the HTML element
      const canvas = await html2canvas(postElement, {
        useCORS: true, // Needed for Cloudinary images
        backgroundColor: null 
      });

      canvas.toBlob(async (blob) => {
        const file = new File([blob], "amispill-post.png", { type: "image/png" });

        // Try native sharing (works on Mobile for Insta Stories)
        if (navigator.share && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Amispill Confession',
            text: `🔥 Read more on Amispill: ${window.location.href}` 
          });
        } else {
          // If desktop or browser doesn't support file share
          alert("📋 Image sharing not supported here. Link copied!");
          handleCopyLink(post);
        }
      }, 'image/png');

    } catch (err) {
      console.error("Share failed:", err);
      handleCopyLink(post);
    }
  }

  const handleCopyLink = (post) => {
     const shareText = `🔥 "${post.text}" - Read more on Amispill! ${window.location.href}`;
     
     if (navigator.clipboard) {
         navigator.clipboard.writeText(shareText);
         alert("📋 Link copied to clipboard!");
     } else {
         prompt("Copy this link:", shareText);
     }
  }

  const toggleLike = async (postId, currentLikes) => {
    const isLiked = currentLikes.includes(user.uid);
    setPosts(prevPosts => prevPosts.map(post => {
      if (post.id === postId) {
        return {
          ...post,
          likes: isLiked ? post.likes.filter(id => id !== user.uid) : [...post.likes, user.uid]
        };
      }
      return post;
    }));
    const postRef = doc(db, "posts", postId);
    try {
      if (isLiked) await updateDoc(postRef, { likes: arrayRemove(user.uid) });
      else await updateDoc(postRef, { likes: arrayUnion(user.uid) });
    } catch (error) { console.error("Like failed:", error); }
  }

  // --- RENDER ---
  if (user) {
    const isAdmin = ADMIN_EMAILS.includes(user.email);

    return (
      <div className="app-container">
        <nav className="navbar">
          <h2 className="brand-logo" onClick={() => setCurrentPage('feed')}>Amispill.</h2>
          <div className="nav-icons">
            <div className="nav-profile" onClick={() => setCurrentPage('profile')}>
              <img src={user.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png"} alt="Profile" />
            </div>
            <button onClick={() => signOut(auth)} className="logout-btn">Logout</button>
          </div>
        </nav>

        <div className="main-content">
          
          {currentPage === 'feed' && (
            <div className="tabs">
              <button className={activeTab === 'feed' ? 'active' : ''} onClick={() => setActiveTab('feed')}>📢 Feed</button>
              <button className={activeTab === 'confessions' ? 'active' : ''} onClick={() => setActiveTab('confessions')}>🎭 Confessions</button>
            </div>
          )}

          {currentPage === 'profile' && (
             <div className="profile-section">
              <button className="back-btn" onClick={() => setCurrentPage('feed')}>← Back to Feed</button>
              <div className="profile-header">
                <img className="big-avatar" src={user.photoURL || "https://cdn-icons-png.flaticon.com/512/847/847969.png"} alt="Me" />
                <h2>{user.displayName}</h2>
                <p>{user.email}</p>
                <div className="upload-avatar-box">
                  <p>Change Photo:</p>
                  <input type="file" onChange={(e) => setProfilePicFile(e.target.files[0])} />
                  <button onClick={updateProfilePic} disabled={!profilePicFile || isUploading}>
                    {isUploading ? "Uploading..." : "Update"}
                  </button>
                </div>
              </div>
              <h3 className="section-title">My Activity</h3>
            </div>
          )}

          {currentPage === 'feed' && (
            <div className={`create-post ${activeTab === 'confessions' ? 'secret-mode' : ''}`}>
              <textarea 
                placeholder={activeTab === 'confessions' ? "Whisper a secret (Anonymous)..." : `What's happening?`}
                rows="3"
                value={postText}
                onChange={(e) => setPostText(e.target.value)}
              ></textarea>
              {imageFile && (
                <div className="image-preview">
                  <p>📸 Image selected</p>
                  <button onClick={() => setImageFile(null)}>Remove</button>
                </div>
              )}
              <div className="post-actions">
                  <div className="left-actions">
                    <input type="file" id="file-upload" accept="image/*" onChange={(e) => setImageFile(e.target.files[0])} style={{display: 'none'}} />
                    <label htmlFor="file-upload" className="icon-btn">📷 Photo</label>
                  </div>
                  <button type="button" className="post-btn" onClick={handlePost} disabled={isUploading}>
                  {isUploading ? "..." : (activeTab === 'confessions' ? "Confess" : "Post")}
                  </button>
              </div>
            </div>
          )}

          <div className="feed-list">
            {posts.map(post => (
              // NOTE: ID Added here for html2canvas
              <div id={`post-${post.id}`} key={post.id} className={`post-card ${post.type === 'confessions' ? 'secret-card' : ''}`}>
                <div className="post-header">
                  <div className="author-info">
                    {post.type !== 'confessions' && (
                       <img src={post.authorPic || "https://cdn-icons-png.flaticon.com/512/847/847969.png"} className="avatar-small" />
                    )}
                    <strong>{post.author}</strong>
                  </div>
                  <span> • {post.createdAt && post.createdAt.toDate ? formatDistanceToNow(post.createdAt.toDate(), { addSuffix: true }) : "Just now"}</span>
                  
                  {isAdmin && <button className="delete-btn" onClick={() => deletePost(post.id)}>🗑️</button>}
                </div>
                
                {post.imageUrl && (
                    <img 
                        src={post.imageUrl} 
                        className="post-image" 
                        alt="Post" 
                        crossOrigin="anonymous" // IMPORTANT for html2canvas
                    />
                )}
                <p>{post.text}</p>
                
                <div className="post-footer">
                  <div className="footer-left">
                    <button className={`like-btn ${post.likes?.includes(user.uid) ? 'liked' : ''}`} onClick={() => toggleLike(post.id, post.likes || [])}>
                      {post.likes?.includes(user.uid) ? '❤️' : '🤍'} {post.likes?.length || 0}
                    </button>
                    
                    <button className="action-btn share-btn" onClick={() => handleShare(post)} title="Share">
                      📤 Share
                    </button>
                  </div>

                  <button className="action-btn report-btn" onClick={() => reportPost(post.id)} title="Report">
                    🚩
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="login-container">
      <div className="card">
        <h1 className="brand-title">Amispill.</h1>
        <p className="tagline">Your campus, unfiltered.</p>
        <form onSubmit={handleAuth}>
          {!isLogin && (
             <div className="input-group">
              <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
             </div>
          )}
          <div className="input-group">
            <input 
              type="text" 
              placeholder="College Email or Username" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
            />
          </div>
          <div className="input-group">
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="login-btn">{isLogin ? "Login" : "Join Amispill"}</button>
        </form>
        <p className="toggle-text" onClick={() => setIsLogin(!isLogin)}>
          {isLogin ? "New here? Join Now" : "Already have an ID? Login"}
        </p>
      </div>
    </div>
  )
}
export default App