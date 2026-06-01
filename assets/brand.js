(function(){
  var FACES=[];for(var i=1;i<=16;i++){FACES.push('/assets/og/og'+(i<10?'0':'')+i+'.png');}
  FACES.forEach(function(s){var im=new Image();im.src=s;});
  var i=0,logo=document.getElementById('brandLogo'),fav=document.getElementById('favicon');
  function tick(){var s=FACES[i%FACES.length];if(logo)logo.src=s;if(fav)fav.href=s;i++;}
  tick();setInterval(tick,750);
})();
