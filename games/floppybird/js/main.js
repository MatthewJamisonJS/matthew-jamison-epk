var debugmode = false;

var states = Object.freeze({
   SplashScreen: 0,
   GameScreen: 1,
   ScoreScreen: 2
});

var currentstate;

var gravity = 0.25;
var velocity = 0;
var position = 180;
var rotation = 0;
var jump = -4.6;
var flyArea = $("#flyarea").height();

var score = 0;
var highscore = 0;

var pipeheight = 90;
var pipewidth = 52;
//pipes[] is the collision queue (front pipe first, spliced off when scored);
//livepipes[] is everything still on screen, which is what gets rendered/reaped.
var pipes = new Array();
var livepipes = new Array();

//the bird never moves horizontally (#player is left: 60px) and its sprite is a
//fixed 34x24, so every collision number below is arithmetic instead of layout.
var playerleft = 60;
var playerelement;
//animPipe used to run a pipe's `left` from 900px to -100px over 7500ms. same
//start, same speed, as numbers the loop owns.
var pipestartx = 900;
var pipespeed = 1000.0 / 7500.0; //px per ms

//the bird's bounding box, kept around so debug drawing can reuse it
var boxleft = 0;
var boxtop = 0;
var boxwidth = 0;
var boxheight = 0;

var replayclickable = false;

//sounds — Web Audio: each effect is decoded once into a buffer and played
//through one shared gain node. buzz's per-tap stop()/play() on an
//HTMLMediaElement costs main-thread time on mobile; a buffer source is
//fire-and-forget on the audio thread. the context is created at boot (it can
//decode while suspended) and resumed on the first gesture.
var audioctx = null;
var sfxgain = null;
var sfxbuffers = {};
var sfxplaying = {};
var sfxnames = ["sfx_wing", "sfx_point", "sfx_hit", "sfx_die", "sfx_swooshing"];

function initAudio()
{
   var Ctx = window.AudioContext || window.webkitAudioContext;
   if(!Ctx || audioctx)
      return;
   audioctx = new Ctx();
   sfxgain = audioctx.createGain();
   sfxgain.gain.value = 0.3; //parity with buzz's volume 30
   sfxgain.connect(audioctx.destination);

   //ogg for chrome/firefox; safari's decoder has no ogg, so it gets m4a
   var format = document.createElement("audio").canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "m4a";
   for(var i = 0; i < sfxnames.length; i++)
      (function(name) {
         fetch("assets/sounds/" + name + "." + format)
            .then(function(res) { return res.arrayBuffer(); })
            .then(function(data) { return audioctx.decodeAudioData(data); })
            .then(function(buffer) { sfxbuffers[name] = buffer; })
            .catch(function() { /* the sound stays silent; the game must not */ });
      })(sfxnames[i]);
}

function resumeAudio()
{
   //iOS creates the context suspended outside a gesture; resume is idempotent
   if(audioctx && audioctx.state === "suspended")
      audioctx.resume();
}

//fire and forget. a replay of the same effect stops the one still playing,
//which is what buzz's stop()+play() pairs did. returns the source so the
//death chain can wait on ended, or null when the effect can't play.
function playSound(name, onended)
{
   if(!audioctx || !sfxbuffers[name])
      return null;
   var prev = sfxplaying[name];
   if(prev)
   {
      prev.onended = null;
      try { prev.stop(); } catch(e) { /* already ended */ }
   }
   var source = audioctx.createBufferSource();
   source.buffer = sfxbuffers[name];
   source.connect(sfxgain);
   sfxplaying[name] = source;
   source.onended = function() {
      if(sfxplaying[name] === source)
         sfxplaying[name] = null;
      if(onended)
         onended();
   };
   source.start(0);
   return source;
}

//play a sound and continue when it ends — continuing immediately if it
//couldn't play, so the score screen never waits on missing audio.
function playSoundThen(name, next)
{
   if(playSound(name, next) === null)
      next();
}

//loops
var loopGameloop;
var loopPipeloop;
//the game loop is vsync-driven (requestAnimationFrame) with a fixed-timestep
//accumulator, so the physics still ticks at exactly 60hz while drawing happens
//once per paint instead of on setInterval's own drifting clock.
var updaterate = 1000.0 / 60.0;
var lastframe = 0;
var frameaccumulator = 0;

$(document).ready(function() {
   if(window.location.search == "?debug")
      debugmode = true;
   if(window.location.search == "?easy")
      pipeheight = 200;

   playerelement = document.getElementById("player");

   initAudio();

   //get the highscore
   var savedscore = getCookie("highscore");
   if(savedscore != "")
      highscore = parseInt(savedscore);

   //start with the splash screen
   showSplash();
});

function getCookie(cname)
{
   var name = cname + "=";
   var ca = document.cookie.split(';');
   for(var i=0; i<ca.length; i++)
   {
      var c = ca[i].trim();
      if (c.indexOf(name)==0) return c.substring(name.length,c.length);
   }
   return "";
}

function setCookie(cname,cvalue,exdays)
{
   var d = new Date();
   d.setTime(d.getTime()+(exdays*24*60*60*1000));
   var expires = "expires="+d.toGMTString();
   document.cookie = cname + "=" + cvalue + "; " + expires;
}

function showSplash()
{
   currentstate = states.SplashScreen;

   //set the defaults (again)
   velocity = 0;
   position = 180;
   rotation = 0;
   score = 0;

   //update the player in preparation for the next game
   $("#player").css({ y: 0, x: 0 });
   updatePlayer();

   playSound("sfx_swooshing");

   //clear out all the pipes if there are any
   $(".pipe").remove();
   pipes = new Array();
   livepipes = new Array();

   //make everything animated again
   $(".animated").css('animation-play-state', 'running');
   $(".animated").css('-webkit-animation-play-state', 'running');

   //fade in the splash
   $("#splash").transition({ opacity: 1 }, 2000, 'ease');
}

function startGame()
{
   currentstate = states.GameScreen;

   //fade out the splash
   $("#splash").stop();
   $("#splash").transition({ opacity: 0 }, 500, 'ease');

   //update the big score
   setBigScore();

   //debug mode?
   if(debugmode)
   {
      //show the bounding boxes
      $(".boundingbox").show();
   }

   //start up our loops. the pipe spawner is not per-frame, so it stays a timer.
   lastframe = 0;
   frameaccumulator = 0;
   loopGameloop = window.requestAnimationFrame(gameloop);
   loopPipeloop = setInterval(updatePipes, 1400);

   //jump from the start!
   playerJump();
}

function updatePlayer()
{
   //apply rotation and position in one composited write. element.style is
   //CSSOM, not an inline style attribute, so this is fine under the CSP the
   //site ships (style-src has no 'unsafe-inline').
   playerelement.style.transform = "translate3d(0px, " + position + "px, 0px) rotate(" + rotation + "deg)";
}

function gameloop(timestamp) {
   //reschedule first: playerDead() cancels the handle we just stored, so a
   //death inside this frame can't leave a stray frame queued.
   loopGameloop = window.requestAnimationFrame(gameloop);

   if(!lastframe)
      lastframe = timestamp;
   var delta = timestamp - lastframe;
   lastframe = timestamp;
   //a backgrounded tab hands back a huge delta on return; don't simulate it
   if(delta > 250)
      delta = 250;

   //fixed timestep: as many 60hz physics steps as the elapsed time earned,
   //then one render.
   frameaccumulator += delta;
   while(frameaccumulator >= updaterate)
   {
      frameaccumulator -= updaterate;
      //dead: the loop is already cancelled and the death drop owns the bird
      if(gamestep() === false)
         return;
   }

   rendergame();
}

//one 1/60s step of physics + collision. every measurement here is arithmetic:
//no getBoundingClientRect, no offset(), nothing that forces a reflow. all
//coordinates are relative to #flyarea, which is what the bird and pipes are
//positioned inside.
function gamestep() {
   //update the player speed/position
   velocity += gravity;
   position += velocity;

   //rotation
   rotation = Math.min((velocity / 10) * 90, 90);

   //move the pipes
   for(var i = 0; i < livepipes.length; i++)
      livepipes[i].x -= pipespeed * updaterate;

   //create the bounding box
   var origwidth = 34.0;
   var origheight = 24.0;

   //the bird rotates about its own centre, so the axis-aligned box the rotated
   //sprite occupies is derived rather than measured. this reproduces exactly
   //what getBoundingClientRect used to hand back.
   var radians = Math.abs(rotation) * Math.PI / 180;
   var rotatedheight = (origwidth * Math.sin(radians)) + (origheight * Math.cos(radians));
   var centerx = playerleft + (origwidth / 2);
   var centery = position + (origheight / 2);

   boxwidth = origwidth - (Math.sin(Math.abs(rotation) / 90) * 8);
   boxheight = (origheight + rotatedheight) / 2;
   boxleft = centerx - (boxwidth / 2);
   boxtop = centery - (boxheight / 2);
   var boxright = boxleft + boxwidth;
   var boxbottom = boxtop + boxheight;

   //did we hit the ground? #land's top edge is #flyarea's bottom edge
   if(centery + (rotatedheight / 2) >= flyArea)
   {
      playerDead();
      return false;
   }

   //have they tried to escape through the ceiling? :o
   //#ceiling spans -16px..0 inside #flyarea, so its bottom edge is simply 0
   if(boxtop <= 0)
      position = 0;

   //we can't go any further without a pipe
   if(pipes[0] == null)
      return true;

   //determine the bounding box of the next pipes inner area
   var nextpipe = pipes[0];

   var pipetop = nextpipe.top;
   var pipeleft = nextpipe.x - 2; // for some reason it starts at the inner pipes offset, not the outer pipes.
   var piperight = pipeleft + pipewidth;
   var pipebottom = pipetop + pipeheight;

   //have we gotten inside the pipe yet?
   if(boxright > pipeleft)
   {
      //we're within the pipe, have we passed between upper and lower pipes?
      if(boxtop > pipetop && boxbottom < pipebottom)
      {
         //yeah! we're within bounds

      }
      else
      {
         //no! we touched the pipe
         playerDead();
         return false;
      }
   }


   //have we passed the imminent danger?
   if(boxleft > piperight)
   {
      //yes, remove it
      pipes.splice(0, 1);

      //and score a point
      playerScore();
   }

   return true;
}

//everything the frame draws, once per paint: two transform writes per moving
//thing and nothing read back.
function rendergame() {
   //update the player
   updatePlayer();

   for(var i = livepipes.length - 1; i >= 0; i--)
   {
      var pipe = livepipes[i];
      pipe.element.style.transform = "translateX(" + pipe.x + "px)";

      //offscreen to the left: gone. this replaces the position().left sweep
      //updatePipes used to run over every pipe in the dom.
      if(pipe.x < -100)
      {
         pipe.element.remove();
         livepipes.splice(i, 1);
      }
   }

   //if we're in debug mode, draw the bounding boxes. these do read layout, but
   //only here: debug is off in normal play, and the boxes live outside
   //#flyarea so they need its offset to line up with the loop's numbers.
   if(debugmode)
   {
      var flyoffset = $("#flyarea").offset();
      $("#playerbox").css({ left: boxleft + flyoffset.left, top: boxtop + flyoffset.top, width: boxwidth, height: boxheight });
      if(pipes[0] != null)
         $("#pipebox").css({ left: (pipes[0].x - 2) + flyoffset.left, top: pipes[0].top + flyoffset.top, width: pipewidth, height: pipeheight });
   }
}

//Handle space bar
$(document).keydown(function(e){
   //space bar!
   if(e.keyCode == 32)
   {
      //in ScoreScreen, hitting space should click the "replay" button. else it's just a regular spacebar hit
      if(currentstate == states.ScoreScreen)
         $("#replay").click();
      else
         screenClick();
   }
});

//Handle mouse down OR touch start. touchstart is bound natively so it can be
//passive: jquery's binding cannot be, and a non-passive touch listener makes
//the browser wait on the handler before it will paint the flap.
if("ontouchstart" in window)
   document.addEventListener("touchstart", screenClick, { passive: true });
else
   $(document).on("mousedown", screenClick);

function screenClick()
{
   resumeAudio();
   if(currentstate == states.GameScreen)
   {
      playerJump();
   }
   else if(currentstate == states.SplashScreen)
   {
      startGame();
   }
}

function playerJump()
{
   velocity = jump;
   //play jump sound
   playSound("sfx_wing");
}

function setBigScore(erase)
{
   var elemscore = $("#bigscore");
   elemscore.empty();

   if(erase)
      return;

   var digits = score.toString().split('');
   for(var i = 0; i < digits.length; i++)
      elemscore.append("<img src='assets/font_big_" + digits[i] + ".png' alt='" + digits[i] + "'>");
}

function setSmallScore()
{
   var elemscore = $("#currentscore");
   elemscore.empty();

   var digits = score.toString().split('');
   for(var i = 0; i < digits.length; i++)
      elemscore.append("<img src='assets/font_small_" + digits[i] + ".png' alt='" + digits[i] + "'>");
}

function setHighScore()
{
   var elemscore = $("#highscore");
   elemscore.empty();

   var digits = highscore.toString().split('');
   for(var i = 0; i < digits.length; i++)
      elemscore.append("<img src='assets/font_small_" + digits[i] + ".png' alt='" + digits[i] + "'>");
}

function setMedal()
{
   var elemmedal = $("#medal");
   elemmedal.empty();

   if(score < 10)
      //signal that no medal has been won
      return false;

   if(score >= 10)
      medal = "bronze";
   if(score >= 20)
      medal = "silver";
   if(score >= 30)
      medal = "gold";
   if(score >= 40)
      medal = "platinum";

   elemmedal.append('<img src="assets/medal_' + medal +'.png" alt="' + medal +'">');

   //signal that a medal has been won
   return true;
}

function playerDead()
{
   //stop animating everything!
   $(".animated").css('animation-play-state', 'paused');
   $(".animated").css('-webkit-animation-play-state', 'paused');

   //drop the bird to the floor. the loop owns #player's transform while the
   //game runs, so hand transit the current values first — otherwise it would
   //tween out of whatever transform it last cached instead of where the bird
   //actually is. the bird now sits at top: 0, so y is the absolute position.
   var playerbottom = position + 34; //we use width because he'll be rotated 90 deg
   var floor = flyArea;
   var movey = Math.max(0, floor - playerbottom);
   $("#player").css({ y: position, rotate: rotation });
   $("#player").transition({ y: (position + movey) + 'px', rotate: 90}, 1000, 'easeInOutCubic');

   //it's time to change states. as of now we're considered ScoreScreen to disable left click/flying
   currentstate = states.ScoreScreen;

   //destroy our gameloops
   if(loopGameloop)
      window.cancelAnimationFrame(loopGameloop);
   clearInterval(loopPipeloop);
   loopGameloop = null;
   loopPipeloop = null;

   //mobile browsers skipped buzz's ended events; keep that shape — straight
   //to the score screen there, the hit→die chain elsewhere
   if(isIncompatible.any())
   {
      //skip right to showing score
      showScore();
   }
   else
   {
      //play the hit sound (then the dead sound) and then show score
      playSoundThen("sfx_hit", function() {
         playSoundThen("sfx_die", function() {
            showScore();
         });
      });
   }
}

function showScore()
{
   //unhide us
   $("#scoreboard").css("display", "block");

   //remove the big score
   setBigScore(true);

   //have they beaten their high score?
   if(score > highscore)
   {
      //yeah!
      highscore = score;
      //save it!
      setCookie("highscore", highscore, 999);
   }

   //update the scoreboard
   setSmallScore();
   setHighScore();
   var wonmedal = setMedal();

   //SWOOSH!
   playSound("sfx_swooshing");

   //show the scoreboard
   $("#scoreboard").css({ y: '40px', opacity: 0 }); //move it down so we can slide it up
   $("#replay").css({ y: '40px', opacity: 0 });
   $("#scoreboard").transition({ y: '0px', opacity: 1}, 600, 'ease', function() {
      //When the animation is done, animate in the replay button and SWOOSH!
      playSound("sfx_swooshing");
      $("#replay").transition({ y: '0px', opacity: 1}, 600, 'ease');

      //also animate in the MEDAL! WOO!
      if(wonmedal)
      {
         $("#medal").css({ scale: 2, opacity: 0 });
         $("#medal").transition({ opacity: 1, scale: 1 }, 1200, 'ease');
      }
   });

   //make the replay button clickable
   replayclickable = true;
}

$("#replay").click(function() {
   //make sure we can only click once
   if(!replayclickable)
      return;
   else
      replayclickable = false;
   //SWOOSH!
   playSound("sfx_swooshing");

   //fade out the scoreboard
   $("#scoreboard").transition({ y: '-40px', opacity: 0}, 1000, 'ease', function() {
      //when that's done, display us back to nothing
      $("#scoreboard").css("display", "none");

      //start the game over!
      showSplash();
   });
});

function playerScore()
{
   score += 1;
   //play score sound
   playSound("sfx_point");
   setBigScore();
}

function updatePipes()
{
   //(pipes that have left the screen are reaped in rendergame, where their
   //position is already known — no dom sweep needed here anymore)

   //rAF is parked while the tab is hidden, so pipes stop moving but this timer
   //keeps firing — don't stack a new pipe on one that hasn't left the spawn point
   if(livepipes.length && livepipes[livepipes.length - 1].x >= pipestartx)
      return;

   //add a new pipe (top height + bottom height  + pipeheight == flyArea) and put it in our tracker
   var padding = 80;
   var constraint = flyArea - pipeheight - (padding * 2); //double padding (for top and bottom)
   var topheight = Math.floor((Math.random()*constraint) + padding); //add lower padding
   var bottomheight = (flyArea - pipeheight) - topheight;
   //heights are applied through CSSOM, not an inline style attribute: the page
   //ships under a CSP with no style-src 'unsafe-inline', which blocks
   //attribute styles. .css() writes element.style, which is not gated.
   var newpipe = $('<div class="pipe animated"><div class="pipe_upper"></div><div class="pipe_lower"></div></div>');
   newpipe.children(".pipe_upper").css("height", topheight + "px");
   newpipe.children(".pipe_lower").css("height", bottomheight + "px");
   $("#flyarea").append(newpipe);

   //tracked as numbers from here on: x is the pipe's left edge inside
   //#flyarea and top is where its gap starts. the loop moves x and writes it
   //back out as a translateX, so a pipe never touches layout.
   var pipe = { element: newpipe[0], x: pipestartx, top: topheight };
   pipe.element.style.transform = "translateX(" + pipe.x + "px)";
   pipes.push(pipe);
   livepipes.push(pipe);
}

var isIncompatible = {
   Android: function() {
   return navigator.userAgent.match(/Android/i);
   },
   BlackBerry: function() {
   return navigator.userAgent.match(/BlackBerry/i);
   },
   iOS: function() {
   return navigator.userAgent.match(/iPhone|iPad|iPod/i);
   },
   Opera: function() {
   return navigator.userAgent.match(/Opera Mini/i);
   },
   Safari: function() {
   return (navigator.userAgent.match(/OS X.*Safari/) && ! navigator.userAgent.match(/Chrome/));
   },
   Windows: function() {
   return navigator.userAgent.match(/IEMobile/i);
   },
   any: function() {
   return (isIncompatible.Android() || isIncompatible.BlackBerry() || isIncompatible.iOS() || isIncompatible.Opera() || isIncompatible.Safari() || isIncompatible.Windows());
   }
};
