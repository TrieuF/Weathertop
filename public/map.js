init();

function init(){
    var map = L.map('map').setView([49, 12.1], 13);

    var mapboxTiles = L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
    maxZoom: 18,
    id: 'mapbox/streets-v11',
    tileSize: 512,
    zoomOffset: -1,
    accessToken: 'pk.eyJ1IjoidHJpZXVmIiwiYSI6ImNsM240Zm14MDBiNmozY3BiNm52OXg4eHoifQ.SihnllsTRzL5uXsWJIgQqg'
    }).addTo(map);
    
    
    $.ajax({
        type: "POST",
        url: "/initmap",
        dataType: "json",
        success: function(data){
            var cities = data.cities;
            
            for(var i= 0; i< cities.length; i++){
                var marker = L.marker([cities[i].latitude,  cities[i].longitude]).addTo(map);
                marker.bindPopup("<a href='/stations/"+cities[i].id+"'>"+cities[i].cityname+"</a>");
            }
        }
    })
}